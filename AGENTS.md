<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Cómo trabajar en este repositorio

Estas reglas no son de estilo. Salieron de fallos concretos que costaron horas
y estuvieron cerca de costar datos. Aplican siempre, a cualquier agente.

## Por qué el listón está alto aquí

Este copiloto registra contabilidad real desde el 6 de agosto de 2026. No es un
experimento. Además, el archivo `.env` local apunta a la base de producción en
Neon, así que cualquier guion ejecutado en la máquina del usuario toca datos
reales. En ese contexto, una explicación segura y equivocada hace más daño que
un "no lo sé".

## Antes de explicar por qué algo falló

**Busca el mensaje de error en el repositorio antes de teorizar.** Casi siempre
sale de una línea concreta del propio código. "No autorizado" no era un fallo de
sesión de Vercel: era un `throw` en la primera línea de una función, visible con
una búsqueda de dos segundos.

**Una causa sin archivo y sin línea es una hipótesis, no un diagnóstico.**
Preséntala como lo que es. Si dices "esto pasó porque X", tienes que poder
señalar qué archivo leíste que lo demuestra.

**"No sé por qué pasó" es una respuesta aceptable.** Una causa inventada no lo
es, porque cierra la investigación: si el usuario se la cree, el problema real
deja de buscarse y vuelve más tarde y peor.

**No confundas correlación con causa.** Que algo ocurriera justo después de un
despliegue no lo convierte en su consecuencia. Comprueba el mecanismo: ¿dónde se
guarda ese dato?, ¿qué comando lo tocaría?

## Antes de proponer una solución

**Lee el código por el que va a pasar.** Una solución que contradice el código
actual es peor que no proponer nada. Ya ocurrió: se recomendó recargar la página
para llegar a la pantalla de inicio de sesión, cuando el intermediario estaba
programado justo para impedir eso.

**Comprueba que el camino completo existe.** Si mandas al usuario a un botón,
verifica que el botón esté ahí.

## Al informar de un arreglo

**Nombra los archivos que cambiaste, por ruta.** No describas el arreglo por su
intención. Decir "arreglé el intermediario" cuando se tocaron cinco líneas de
otra pantalla es un informe falso, aunque el arreglo funcione.

**Di cómo lo comprobaste, o di que no lo comprobaste.** Compilar, ejecutar una
prueba, una petición contra el sistema desplegado. Si no se verificó, dilo con
esas palabras.

**Distingue lo que arreglaste de lo que sigue roto.** Un parche que resuelve el
caso del usuario pero deja el fallo de fondo intacto se informa así, no como
"ya no le puede pasar a nadie".

## Al verificar

**Verifica contra el sistema real, no contra la configuración local.** Un
archivo de configuración del repositorio puede apuntar a otro sitio que el que
el usuario está mirando. Cuando el usuario describa algo que no cuadra con lo
que ves, la primera sospecha es que estás mirando el lugar equivocado, no que él
se equivoca. Pregúntale qué ve en pantalla.

**Prefiere la comprobación que no escribe nada.** Una petición de solo lectura
contra la aplicación desplegada demuestra lo mismo que una prueba manual, sin
tocar datos ni gastar cuota.

## Con la base de datos y con lo irreversible

**Los guiones de `scripts/` que escriben pasan por `guardia-base.js`.** Si
añades uno que borre o sobrescriba, engánchalo también. Nunca lo sortees.

**Antes de borrar o sobrescribir, enseña el destino y espera respuesta.**
Servidor y nombre de la base, en el mensaje, antes de ejecutar.

**Las credenciales no se piden por el chat.** Ni claves, ni contraseñas, ni
tokens. Se indica dónde ponerlas y las pone el usuario.

## Sobre el tono

Explicar bonito no es explicar bien. Cuando no tengas la evidencia, dilo antes
de la explicación, no después. El usuario prefiere una duda declarada a una
certeza que luego hay que desmontar.
