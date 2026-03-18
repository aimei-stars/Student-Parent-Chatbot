import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { Mic, Info, Mail, Clock, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AudioProcessor } from '../utils/audio';
import { PERSONA_PROMPT } from '../constants';

export default function LiveAssistant() {
  const isRecordingRef = useRef(false);
  const isMutedRef = useRef(false);

  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<any>(null);
  const audioProcessorRef = useRef<AudioProcessor | null>(null);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { cleanupSession(); };
  }, []);

  // Shared cleanup — stops audio AND closes session safely
  const cleanupSession = () => {
    if (audioProcessorRef.current) {
      audioProcessorRef.current.resetPlayback();
      audioProcessorRef.current.stopRecording();
      audioProcessorRef.current = null;
    }
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }
  };

  const startSession = async () => {
    try {
      setStatus('connecting');
      setError(null);

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      audioProcessorRef.current = new AudioProcessor((base64Data) => {
        if (sessionRef.current && isRecordingRef.current && !isMutedRef.current) {
          sessionRef.current.sendRealtimeInput({
            media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        }
      });

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            // Aoede supports both English and Spanish naturally
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
          },
          systemInstruction: PERSONA_PROMPT,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setStatus('active');
            audioProcessorRef.current?.startRecording();
            setIsRecording(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
              audioProcessorRef.current?.playAudioChunk(message.serverContent.modelTurn.parts[0].inlineData.data);
            }
            if (message.serverContent?.interrupted) {
              audioProcessorRef.current?.resetPlayback();
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error. Please try again.");
            setStatus('error');
          },
          onclose: () => {
            setIsConnected(false);
            setStatus('idle');
            setIsRecording(false);
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to start session:", err);
      setError("Failed to initialize assistant.");
      setStatus('error');
    }
  };

  const stopSession = () => {
    cleanupSession();
    setIsConnected(false);
    setIsRecording(false);
    setIsMuted(false);
    setStatus('idle');
    setError(null);
  };

  const toggleMute = () => { setIsMuted(!isMuted); };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto p-4 md:p-8 space-y-8">

      {/* Header */}
      <header className="text-center space-y-2">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-5xl font-serif font-light text-stone-800"
        >
          Ms. Peng's Science Class Chat Assistant
        </motion.h1>
        <p className="text-stone-500 font-serif italic">
          Villa Fundamental • 6th Grade Science
        </p>
        <p className="text-stone-400 text-sm">
          Habla español? The assistant will switch languages for you.
        </p>
      </header>

      {/* Main Interaction Area */}
      <main className="flex-1 flex flex-col items-center justify-center space-y-12">
        <motion.div
          onClick={status === 'active' ? stopSession : startSession}
          animate={{
            scale: status === 'active' ? [1, 1.02, 1] : 1,
            borderColor: status === 'active' ? '#C41E3A' : '#002366'
          }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="w-64 h-64 rounded-full border-4 flex items-center justify-center bg-white shadow-2xl relative overflow-hidden cursor-pointer hover:shadow-inner transition-shadow"
        >
          <AnimatePresence mode="wait">
            {status === 'idle' && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center p-6">
                <div className="w-20 h-20 bg-[#002366] rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                  <Mic className="w-10 h-10 text-white" />
                </div>
                <p className="text-[#002366] font-bold uppercase tracking-widest">Start Chat</p>
                <p className="text-stone-400 text-xs mt-1">Iniciar Chat</p>
              </motion.div>
            )}
            {status === 'connecting' && (
              <motion.div key="connecting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center">
                <div className="w-12 h-12 border-4 border-stone-200 border-t-[#C41E3A] rounded-full animate-spin mb-4" />
                <p className="text-stone-500 font-medium">Connecting...</p>
              </motion.div>
            )}
            {status === 'active' && (
              <motion.div key="active" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="flex flex-col items-center">
                <div className="flex space-x-1 items-end h-12 mb-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <motion.div key={i} animate={{ height: [12, 40, 12] }} transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }} className="w-2 bg-[#C41E3A] rounded-full" />
                  ))}
                </div>
                <p className="text-[#C41E3A] font-bold uppercase tracking-widest">End Chat</p>
                <p className="text-stone-400 text-xs mt-1">Terminar Chat</p>
              </motion.div>
            )}
            {status === 'error' && (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center p-6">
                <Info className="w-12 h-12 mx-auto text-red-500 mb-4" />
                <p className="text-red-600 font-medium text-sm">{error || "Something went wrong"}</p>
                <p className="text-stone-400 text-xs mt-2">Tap to retry</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>

      {/* Quick Info Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-8">
        <div className="bg-[#002366] p-6 rounded-3xl shadow-md border border-white/10 space-y-3 text-white">
          <div className="flex items-center space-x-2 text-white">
            <Clock className="w-4 h-4" />
            <h3 className="font-bold text-sm uppercase tracking-wider">Office Hours</h3>
          </div>
          <p className="text-white font-bold text-sm">Tue & Thu: 2:30 – 3:00 PM</p>
          <p className="text-white font-bold text-sm">Daily: Before 8:00 AM</p>
        </div>
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-stone-100 space-y-3">
          <div className="flex items-center space-x-2 text-stone-800">
            <Mail className="w-4 h-4" />
            <h3 className="font-bold text-sm uppercase tracking-wider">Contact</h3>
          </div>
          <p className="text-stone-800 font-bold text-sm break-all">hsinjan.peng@sausd.us</p>
          <p className="text-stone-800 font-bold text-sm">ParentSquare App</p>
        </div>
        <div className="bg-[#C41E3A] p-6 rounded-3xl shadow-md border border-white/10 space-y-3 text-white">
          <div className="flex items-center space-x-2 text-white">
            <BookOpen className="w-4 h-4" />
            <h3 className="font-bold text-sm uppercase tracking-wider">Resources</h3>
          </div>
          <p className="text-white font-bold text-sm">
            Grades: <a href="https://eportal.sausd.us/ParentPortal/LoginParent.aspx" target="_blank" rel="noopener noreferrer" className="text-white underline hover:text-white/80 font-black">Aeries</a>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center py-4 border-t border-stone-100">
        <p className="text-stone-400 text-xs uppercase tracking-widest">Villa Fundamental • Science Department</p>
      </footer>
    </div>
  );
}
