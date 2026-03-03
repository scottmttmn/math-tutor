'use client';

import { useState, useEffect, useRef } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

const DEFAULT_QUESTION = 'I need help with this part of my work.';

interface Props {
  isOpen: boolean;
  capturedImage: string;
  onSend: (question: string) => void;
  onCancel: () => void;
}

export default function HelpQuestionModal({
  isOpen,
  capturedImage,
  onSend,
  onCancel,
}: Props) {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const prevQuestionRef = useRef(DEFAULT_QUESTION);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
    isListening,
    transcript,
    isSupported: voiceSupported,
    error: voiceError,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  // Reset and focus on open
  useEffect(() => {
    if (isOpen) {
      setQuestion(DEFAULT_QUESTION);
      prevQuestionRef.current = DEFAULT_QUESTION;
      resetTranscript();
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, resetTranscript]);

  // Voice transcript → textarea
  useEffect(() => {
    if (transcript) {
      setQuestion(transcript);
    }
  }, [transcript]);

  // If voice fails immediately, restore previous question
  useEffect(() => {
    if (voiceError && !transcript && !question) {
      setQuestion(prevQuestionRef.current);
    }
  }, [voiceError, transcript, question]);

  if (!isOpen) return null;

  const handleSend = () => {
    const finalQuestion = question.trim() || DEFAULT_QUESTION;
    if (isListening) stopListening();
    onSend(finalQuestion);
  };

  const handleCancel = () => {
    if (isListening) stopListening();
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const toggleVoice = () => {
    if (isListening) {
      stopListening();
    } else {
      prevQuestionRef.current = question;
      if (question === DEFAULT_QUESTION) {
        setQuestion('');
      }
      resetTranscript();
      startListening();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          What do you need help with?
        </h2>

        {/* Image preview */}
        {capturedImage && (
          <div className="mb-3 p-2 bg-gray-50 rounded-lg border border-gray-200">
            <img
              src={`data:image/png;base64,${capturedImage}`}
              alt="Captured work"
              className="max-h-32 mx-auto rounded object-contain"
            />
          </div>
        )}

        {/* Question input */}
        <div className="relative mb-3">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            className="w-full px-3 py-2 pr-10 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Type your question..."
          />

          {voiceSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              title={isListening ? 'Stop recording' : 'Use voice input'}
              className={`absolute right-2 bottom-2 p-1.5 rounded-lg transition-colors ${
                isListening
                  ? 'bg-red-100 text-red-600 animate-pulse'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              <MicIcon />
            </button>
          )}
        </div>

        {/* Listening indicator */}
        {isListening && (
          <p className="text-xs text-red-500 mb-3 flex items-center gap-1">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            Listening... speak your question
          </p>
        )}

        {/* Voice error */}
        {voiceError && !isListening && (
          <p className="text-xs text-red-500 mb-3">{voiceError}</p>
        )}

        <p className="text-xs text-gray-400 mb-4">
          Press Cmd+Enter to send, Escape to cancel
        </p>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            className="px-4 py-2 text-sm text-white bg-green-500 rounded-lg hover:bg-green-600"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="1" width="6" height="9" rx="3" />
      <path d="M3 7a5 5 0 0 0 10 0" />
      <line x1="8" y1="12" x2="8" y2="15" />
      <line x1="5" y1="15" x2="11" y2="15" />
    </svg>
  );
}
