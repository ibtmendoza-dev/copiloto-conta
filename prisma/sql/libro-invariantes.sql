-- Invariantes del libro de dinero, impuestas por PostgreSQL.
-- Ver docs/DISENO-libro-de-dinero.md §3 en el repositorio de la plataforma.
--
-- POR QUE ADEMAS DE LA VALIDACION EN LA APLICACION. `crearAsiento` ya valida
-- antes de escribir, pero solo protege a quien pase por ella. Esto protege
-- tambien contra SQL directo, contra un script escrito con prisa, contra otro
-- servicio que algun dia escriba en la misma base, y contra una version futura
-- de la aplicacion que se salte la funcion sin querer. En un libro de dinero,
-- una fila mal escrita no da error: da un saldo equivocado, callado y
-- permanente.
--
-- POR QUE LOS DISPARADORES SON DIFERIDOS. Un asiento se escribe por partes:
-- despues de insertar el primer apunte, todavia no cuadra. Un disparador
-- inmediato rechazaria cualquier asiento correcto. `DEFERRABLE INITIALLY
-- DEFERRED` retrasa la comprobacion al momento de confirmar la transaccion,
-- que es cuando el asiento ya esta completo.
--
-- Este archivo se puede volver a ejecutar cuantas veces haga falta: todo va
-- con DROP IF EXISTS o CREATE OR REPLACE. Hay que volver a aplicarlo despues
-- de cualquier `prisma db push` que recree las tablas, porque los disparadores
-- se irian con ellas.

-- ============================================================
-- 1. Cada apunte, por si solo, tiene que estar bien formado
-- ============================================================
-- El sentido de un apunte lo da el lado en el que esta, no el signo: un
-- negativo en `debe` seria un abono disfrazado que cuadraria la suma y
-- ensuciaria el saldo de la cuenta.
ALTER TABLE "Apunte" DROP CONSTRAINT IF EXISTS apunte_importes_validos;
ALTER TABLE "Apunte" ADD CONSTRAINT apunte_importes_validos CHECK (
  debe >= 0
  AND haber >= 0
  AND NOT (debe > 0 AND haber > 0)   -- no puede cargar y abonar a la vez
  AND (debe > 0 OR haber > 0)        -- ni quedarse sin mover nada
);

-- ============================================================
-- 2. Cada asiento tiene que cuadrar y tener al menos dos lados
-- ============================================================
CREATE OR REPLACE FUNCTION libro_verificar_cuadre(p_asiento_id text)
RETURNS void AS $$
DECLARE
  v_debe  numeric(14,2);
  v_haber numeric(14,2);
  v_n     integer;
BEGIN
  -- Si el asiento ya no existe --porque la misma transaccion lo borro-- no hay
  -- nada que verificar. Sin esto, vaciar el libro seria imposible.
  IF NOT EXISTS (SELECT 1 FROM "Asiento" WHERE id = p_asiento_id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(debe), 0), COALESCE(SUM(haber), 0), COUNT(*)
    INTO v_debe, v_haber, v_n
    FROM "Apunte" WHERE "asientoId" = p_asiento_id;

  IF v_n < 2 THEN
    RAISE EXCEPTION
      'El asiento % tiene % apunte(s). Un hecho economico necesita al menos dos lados: de donde sale y a donde entra.',
      p_asiento_id, v_n;
  END IF;

  IF v_debe <> v_haber THEN
    RAISE EXCEPTION
      'El asiento % no cuadra: debe %, haber %, diferencia %.',
      p_asiento_id, v_debe, v_haber, v_debe - v_haber;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION libro_cuadre_desde_apunte()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM libro_verificar_cuadre(OLD."asientoId");
  ELSE
    PERFORM libro_verificar_cuadre(NEW."asientoId");
    -- Mover un apunte de asiento descuadra los dos, no solo el de destino.
    IF TG_OP = 'UPDATE' AND NEW."asientoId" <> OLD."asientoId" THEN
      PERFORM libro_verificar_cuadre(OLD."asientoId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION libro_cuadre_desde_asiento()
RETURNS trigger AS $$
BEGIN
  -- Un asiento insertado sin ningun apunte no dispararia el disparador de
  -- Apunte, y se quedaria ahi como un hecho vacio. Por eso hace falta este.
  PERFORM libro_verificar_cuadre(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS libro_cuadre_apunte ON "Apunte";
CREATE CONSTRAINT TRIGGER libro_cuadre_apunte
  AFTER INSERT OR UPDATE OR DELETE ON "Apunte"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION libro_cuadre_desde_apunte();

DROP TRIGGER IF EXISTS libro_cuadre_asiento ON "Asiento";
CREATE CONSTRAINT TRIGGER libro_cuadre_asiento
  AFTER INSERT ON "Asiento"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION libro_cuadre_desde_asiento();

-- ============================================================
-- 3. Un asiento no se edita (invariante 2)
-- ============================================================
-- Con UNA excepcion, que es la unica edicion legitima que contempla el diseño:
-- pasar de PROPUESTO a FIRME. Es el acto de que una persona confirme un
-- importe que dedujo la inteligencia artificial. Todo lo demas --cambiar un
-- importe, una fecha, una descripcion, o volver de FIRME a PROPUESTO-- se
-- rechaza: un error se corrige con un asiento NUEVO que invierta al anterior,
-- para que el historico siga explicando por que el saldo es el que es.
CREATE OR REPLACE FUNCTION libro_asiento_solo_confirmable()
RETURNS trigger AS $$
BEGIN
  IF OLD.estado = 'PROPUESTO' AND NEW.estado = 'FIRME'
     AND NEW.id                IS NOT DISTINCT FROM OLD.id
     AND NEW."contribuyenteId" IS NOT DISTINCT FROM OLD."contribuyenteId"
     AND NEW."fechaOcurrencia" IS NOT DISTINCT FROM OLD."fechaOcurrencia"
     AND NEW.descripcion       IS NOT DISTINCT FROM OLD.descripcion
     AND NEW.origen            IS NOT DISTINCT FROM OLD.origen
     AND NEW."referenciaOrigen" IS NOT DISTINCT FROM OLD."referenciaOrigen"
     AND NEW."createdAt"       IS NOT DISTINCT FROM OLD."createdAt"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Un asiento no se edita. Lo unico que puede cambiar es pasar de PROPUESTO a FIRME; cualquier otra correccion es un asiento nuevo que invierta al anterior.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS libro_no_editar_asiento ON "Asiento";
CREATE TRIGGER libro_no_editar_asiento
  BEFORE UPDATE ON "Asiento"
  FOR EACH ROW EXECUTE FUNCTION libro_asiento_solo_confirmable();

CREATE OR REPLACE FUNCTION libro_apunte_inmutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Un apunte no se edita nunca. Para corregir un asiento, se registra otro que lo invierta.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS libro_no_editar_apunte ON "Apunte";
CREATE TRIGGER libro_no_editar_apunte
  BEFORE UPDATE ON "Apunte"
  FOR EACH ROW EXECUTE FUNCTION libro_apunte_inmutable();

-- ============================================================
-- SOBRE EL BORRADO, que a proposito NO se bloquea
-- ============================================================
-- Borrar un solo apunte ya es imposible en la practica: descuadra el asiento y
-- el disparador de cuadre lo rechaza al confirmar. Y borrar un asiento con
-- apuntes lo impide la clave foranea. Lo unico que se puede hacer es vaciar el
-- libro entero en una transaccion, que es exactamente lo que necesita el
-- procedimiento de arranque limpio mientras el sistema esta en pruebas.
--
-- Cuando el sistema arranque de verdad, conviene revisar esta decision: a
-- partir de ahi, borrar asientos ya no deberia ser posible sin dejar rastro.
