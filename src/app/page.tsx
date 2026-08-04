"use client"

import { useState, useRef, useEffect } from "react"
import { Bot, User, Paperclip, X, Camera, LogOut, WifiOff } from "lucide-react"
import { createMovimiento } from "./actions"
import { logoutAction } from "./login/actions"
import { savePendingMovement, getPendingMovements, deletePendingMovement } from "@/lib/offlineQueue"

export default function CopilotChat() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "assistant",
      content: "Hola. Soy tu Copiloto Administrativo.\n\nPuedes registrar tus movimientos operacionales aquí en lenguaje natural. Por ejemplo:\n- \"Compré verduras por $850 en efectivo.\"\n- \"Vendí 3 asesorías por $5,000.\"\n\n¿En qué te ayudo hoy?",
      time: "Ahora"
    }
  ])
  const [newMessage, setNewMessage] = useState({ content: "" })
  const [attachedImage, setAttachedImage] = useState<string | null>(null)
  const [isTyping, setIsTyping] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  const recognitionRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [newMessage.content])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping])

  const syncPendingMovements = async () => {
    if (isSyncing) return;
    try {
      const pending = await getPendingMovements();
      if (pending.length > 0) {
        setIsSyncing(true);
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: "assistant",
          content: `🔄 Sincronizando ${pending.length} movimiento(s) guardado(s) sin conexión...`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
        
        let syncedCount = 0;
        for (const item of pending) {
          try {
            await createMovimiento({
              inputOriginal: item.inputOriginal,
              imageBase64: item.imageBase64,
              clientMessageId: item.clientMessageId
            });
            await deletePendingMovement(item.id);
            syncedCount++;
          } catch (e) {
            console.error("Failed to sync item", e);
            break; 
          }
        }
        
        if (syncedCount > 0) {
          setMessages(prev => [...prev, {
            id: Date.now() + 1,
            role: "assistant",
            content: `✅ ¡Sincronización completada! Tus movimientos ya están en la nube.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncing(false);
    }
  }

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false)
      syncPendingMovements()
    }
    const handleOffline = () => setIsOffline(true)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    // Check initial state
    setIsOffline(!navigator.onLine)
    if (navigator.onLine) {
      syncPendingMovements()
    }
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition()
        recognitionRef.current.continuous = true
        recognitionRef.current.interimResults = true
        recognitionRef.current.lang = 'es-MX'

        recognitionRef.current.onresult = (event: any) => {
          let currentTranscript = ''
          for (let i = 0; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript
          }
          setNewMessage({ content: currentTranscript })
        }

        recognitionRef.current.onerror = (event: any) => {
          console.error("Speech recognition error", event.error)
          if (event.error === 'not-allowed') {
            alert("Acceso al micrófono denegado. Por favor, dale permisos al navegador.")
          }
          setIsListening(false)
        }

        recognitionRef.current.onend = () => {
          setIsListening(false)
        }
      } else {
        console.warn("SpeechRecognition API no soportada en este navegador.")
      }
    }
  }, [])

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Tu navegador no soporta dictado por voz de forma nativa. Te recomiendo usar Google Chrome o Edge.")
      return
    }

    if (isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
    } else {
      setNewMessage({ content: "" })
      try {
        recognitionRef.current.start()
        setIsListening(true)
      } catch (e) {
        console.error("Error al iniciar reconocimiento:", e)
      }
    }
  }

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_SIZE = 1200; 

          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7)); 
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const compressedBase64 = await compressImage(file);
      setAttachedImage(compressedBase64);
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.content.trim() && !attachedImage) return

    const userMessage = {
      id: Date.now(),
      role: "user",
      content: newMessage.content || "Se adjuntó un comprobante.",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    
    setMessages(prev => [...prev, userMessage])
    const contentToSend = newMessage.content
    const imageToSend = attachedImage
    const clientMessageId = crypto.randomUUID()
    
    setNewMessage({ content: "" })
    setAttachedImage(null)
    setIsTyping(true)
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    try {
      if (!navigator.onLine) {
        throw new Error("offline");
      }

      const result = await createMovimiento({
        inputOriginal: contentToSend,
        imageBase64: imageToSend || undefined,
        clientMessageId
      });

      setIsTyping(false)

      if (result.success && result.data && Array.isArray(result.data)) {
        let contentStr = `✨ He analizado tu mensaje y registrado **${result.data.length} movimiento(s)**:\n\n`;
        
        result.data.forEach((mov: any, index: number) => {
          const extraction = result.ia_extraction?.movimientos?.[index];
          const extraInfo = mov.contraparteNombre ? `\n  - **Proveedor:** ${mov.contraparteNombre}` : '';
          const ivaInfo = mov.iva != null 
            ? `\n  - **Subtotal:** $${mov.subtotal} | **IVA (${mov.tasaIva}):** $${mov.iva}` 
            : '';
          const conceptosInfo = extraction?.articulos?.length 
            ? `\n  - **Detalle de Artículos:**\n    - ` + extraction.articulos.map((c: any) => `[${c.cantidad}x] ${c.descripcion} ($${c.importeTotal})`).join('\n    - ')
            : '';
          const contextoIcon = mov.contexto === 'PERSONAL' ? '🏠 PERSONAL' : '🏢 NEGOCIO';
            
          contentStr += `**${index + 1}. ${mov.tipo} por $${mov.importe}** [${contextoIcon}] [🏷️ ${mov.categoria}] ${extraInfo}${ivaInfo}${conceptosInfo}\n  - **Estado:** ${mov.estado}\n\n`;
        });

        contentStr += `La información ya es inmutable en tu Motor de Realidad.`;

        if ((result as any).fallosInventario?.length) {
          contentStr += `\n\n⚠️ **El inventario NO se actualizó** (${(result as any).fallosInventario.length} entrada(s)). El movimiento contable sí quedó registrado.\n`;
          contentStr += (result as any).fallosInventario.map((f: any) => `  - ${f.motivo}`).join('\n');
        }

        const responseMessage = {
          id: Date.now() + 1,
          role: "assistant",
          content: contentStr,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
        setMessages(prev => [...prev, responseMessage])
      } else {
        const errorMessage = {
          id: Date.now() + 1,
          role: "assistant",
          content: `❌ Hubo un error al procesar el mensaje: ${result.error}`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
        setMessages(prev => [...prev, errorMessage])
      }
    } catch (error) {
      setIsTyping(false)
      
      // Fallback para Offline
      await savePendingMovement({
        inputOriginal: contentToSend,
        imageBase64: imageToSend || undefined,
        clientMessageId
      });

      const errorMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: `⏳ **Guardado en el celular (Sin conexión).**\nTu ticket está seguro. Se enviará automáticamente cuando recuperes la señal.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
      setMessages(prev => [...prev, errorMessage])
    }
  }

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-100 font-sans">
      <aside className="w-64 border-r border-neutral-800 bg-neutral-900 hidden md:flex flex-col">
        <div className="p-5 border-b border-neutral-800">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent flex items-center gap-2">
            <Bot size={24} className="text-blue-400" />
            Copiloto
          </h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-neutral-500 font-semibold mb-3 uppercase tracking-wider">Historial</p>
          <button className="w-full text-left px-3 py-2 text-sm bg-neutral-800 text-neutral-200 rounded-md truncate hover:bg-neutral-700 transition-colors border border-neutral-700">
            Registro de la realidad
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden bg-neutral-950">
        <header className="h-16 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-medium text-neutral-200">Motor de Realidad (Prototipo v0.2)</h2>
            {isOffline && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                <WifiOff size={14} /> Sin conexión
              </span>
            )}
          </div>
          <form action={logoutAction}>
            <button type="submit" className="text-neutral-400 hover:text-white p-2 rounded-lg hover:bg-neutral-800 transition-colors" title="Cerrar sesión">
              <LogOut size={18} />
            </button>
          </form>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scroll-smooth z-0">
          {messages.map(msg => (
            <div key={msg.id} className={`flex gap-4 max-w-3xl mx-auto ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-lg ${msg.role === "assistant" ? "bg-gradient-to-br from-indigo-500 to-blue-600 text-white" : "bg-neutral-800 text-neutral-300"}`}>
                {msg.role === "assistant" ? <Bot size={20} /> : <User size={20} />}
              </div>
              <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`px-5 py-3.5 rounded-2xl max-w-2xl shadow-sm ${msg.role === "user" ? "bg-blue-600 text-white rounded-tr-none" : "bg-neutral-900 border border-neutral-800 text-neutral-200 rounded-tl-none"}`}>
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
                <span className="text-xs text-neutral-500 mt-2 px-1">{msg.time}</span>
              </div>
            </div>
          ))}
          
          {isTyping && (
            <div className="flex gap-4 max-w-3xl mx-auto">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center shrink-0 shadow-lg">
                <Bot size={20} />
              </div>
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl rounded-tl-none px-5 py-4 flex items-center gap-1.5">
                <div className="w-2 h-2 bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-neutral-500 rounded-full animate-bounce"></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-neutral-900 border-t border-neutral-800">
          <div className="max-w-3xl mx-auto flex flex-col gap-2">
            
            {attachedImage && (
              <div className="relative self-start mb-2">
                <img src={attachedImage} alt="Attachment" className="h-20 rounded-lg border border-neutral-700 object-cover" />
                <button 
                  onClick={() => setAttachedImage(null)}
                  className="absolute -top-2 -right-2 bg-neutral-800 text-neutral-400 hover:text-white rounded-full p-1 border border-neutral-700"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <form onSubmit={handleSendMessage} className="relative flex items-center gap-2">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="p-3 bg-neutral-800 text-neutral-400 rounded-xl hover:bg-neutral-700 hover:text-neutral-200 transition-colors"
                title="Tomar fotografía"
              >
                <Camera size={20} />
              </button>
              <input 
                type="file" 
                ref={cameraInputRef}
                onChange={handleImageUpload}
                accept="image/*"
                capture="environment"
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-3 bg-neutral-800 text-neutral-400 rounded-xl hover:bg-neutral-700 hover:text-neutral-200 transition-colors"
                title="Adjuntar comprobante"
              >
                <Paperclip size={20} />
              </button>
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleImageUpload}
                accept="image/*"
                className="hidden"
              />
              
              <div className="relative flex-1 flex items-center">
                <textarea
                  ref={textareaRef}
                  value={newMessage.content}
                  onChange={(e) => setNewMessage({ content: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (newMessage.content.trim() || attachedImage) {
                        handleSendMessage(e as any);
                      }
                    }
                  }}
                  placeholder={isListening ? "Escuchando..." : "Ej. Compré verduras por $850..."}
                  rows={1}
                  className={`w-full bg-neutral-800 text-neutral-100 placeholder-neutral-500 border rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:ring-1 transition-colors resize-none overflow-y-auto ${
                    isListening 
                      ? "border-red-500 focus:ring-red-500 focus:border-red-500 bg-red-950/20" 
                      : "border-neutral-700 focus:ring-blue-500 focus:border-blue-500"
                  }`}
                  style={{ minHeight: '48px', maxHeight: '120px' }}
                />
              <button
                type="button"
                onClick={toggleListening}
                className={`absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full transition-colors ${
                  isListening ? "bg-red-500 text-white animate-pulse" : "text-neutral-400 hover:text-white"
                }`}
                title={isListening ? "Detener dictado" : "Dictar por voz"}
              >
                {isListening ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="6" height="6" x="9" y="9" rx="1"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                )}
              </button>
            </div>
              <button
                type="submit"
                disabled={!newMessage.content.trim() && !attachedImage}
                className="p-3 bg-neutral-800 text-neutral-300 rounded-xl hover:bg-neutral-700 hover:text-neutral-100 disabled:opacity-50 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
              </button>
            </form>
            <div className="text-center mt-2">
              <span className="text-[10px] text-neutral-600">El Copiloto abstrae la complejidad. Céntrate en la realidad. (v0.2 PWA)</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
