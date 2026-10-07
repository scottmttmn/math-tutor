'use client';

import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;
  isSupported: boolean;
  error: string;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
}

const subscribeSupport = () => () => {};
const getSupport = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export function useSpeechRecognition(onTranscript?: (text: string) => void): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const isSupported = useSyncExternalStore(subscribeSupport, getSupport, () => false);
  const onTranscriptRef = useRef(onTranscript);
  const [error, setError] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const acceptTranscript = useRef(false);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    setError('');

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (!acceptTranscript.current || recognitionRef.current !== recognition) return;
      let text = '';
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      setTranscript(text);
      onTranscriptRef.current?.(text);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      acceptTranscript.current = false;
      setIsListening(false);
      if (event.error === 'not-allowed') {
        setError('Microphone access denied. Allow microphone in your browser settings.');
      } else if (event.error === 'no-speech') {
        setError('No speech detected. Try again.');
      } else if (event.error === 'network') {
        setError('Network error. Speech recognition requires an internet connection.');
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      acceptTranscript.current = false;
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    try {
      acceptTranscript.current = true;
      recognition.start();
      setIsListening(true);
    } catch (err) {
      acceptTranscript.current = false;
      setError(`Could not start speech recognition: ${err instanceof Error ? err.message : String(err)}`);
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    acceptTranscript.current = false;
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setError('');
  }, []);

  useEffect(() => {
    return () => {
      acceptTranscript.current = false;
      recognitionRef.current?.stop();
    };
  }, []);

  return {
    isListening,
    transcript,
    isSupported,
    error,
    startListening,
    stopListening,
    resetTranscript,
  };
}
