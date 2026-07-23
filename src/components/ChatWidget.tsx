"use client";

import { useChat } from "@ai-sdk/react";
import { MessageCircle, X, Send, Bot, User, Loader2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export default function ChatWidget({ dataSummary, topTasks, headline }: any) {
  const [isOpen, setIsOpen] = useState(false);
  
  // We pass initial system context in body so the API can construct the system message
  const chatState = useChat({
    api: '/api/chat',
    body: {
      dataContext: {
        summary: dataSummary,
        topTasks: topTasks,
        headline: headline
      }
    }
  } as any) as any;
  const { messages, input, handleInputChange, handleSubmit, isLoading } = chatState;
  
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <>
      {/* Floating Button */}
      <button 
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 h-14 w-14 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-xl hover:bg-indigo-700 transition-transform print:hidden ${isOpen ? 'scale-0' : 'scale-100'}`}
      >
        <MessageCircle size={28} />
      </button>

      {/* Chat Window */}
      <div className={`fixed bottom-6 right-6 w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col transition-all duration-300 transform origin-bottom-right print:hidden ${isOpen ? 'scale-100 opacity-100' : 'scale-0 opacity-0 pointer-events-none'}`} style={{ height: '500px', zIndex: 50 }}>
        
        {/* Header */}
        <div className="bg-indigo-600 text-white p-4 rounded-t-2xl flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Bot size={20} />
            <h3 className="font-semibold">AI Data Assistant</h3>
          </div>
          <button onClick={() => setIsOpen(false)} className="hover:bg-indigo-500 p-1 rounded-md transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
          {messages.length === 0 && (
            <div className="text-center text-slate-500 text-sm mt-10">
              <p>Hi! I'm grounded in your HR & Activity data.</p>
              <p className="mt-2">Ask me things like:</p>
              <p className="italic text-indigo-600 mt-1">"What is our top automation priority?"</p>
            </div>
          )}
          {messages.map((m: any) => (
            <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${m.role === 'user' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-700'}`}>
                {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
              </div>
              <div className={`px-4 py-2 rounded-2xl max-w-[80%] text-sm ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'}`}>
                {m.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                <Loader2 size={16} className="animate-spin text-slate-500" />
              </div>
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl rounded-tl-sm shadow-sm">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-3 bg-white border-t border-slate-100 rounded-b-2xl">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              value={input}
              onChange={handleInputChange}
              placeholder="Ask about the data..."
              className="flex-1 bg-slate-100 text-sm border-none rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button 
              type="submit" 
              disabled={isLoading || !input?.trim()}
              className="bg-indigo-600 text-white h-10 w-10 rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
            >
              <Send size={16} className="ml-1" />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
