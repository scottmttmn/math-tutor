'use client';

import { useEffect, useState } from 'react';
import { loadProfile } from '@/lib/db';
import { favoriteChoices, topicChoices, type TopicChoice } from '@/lib/tutorProblem';
import { FavoriteStar, TutorIcon } from '@/components/common/Icons';
import type { TutorProblem } from '@/types';

interface Props {
  onClose: () => void;
  /** Opens the new board, where the tutor writes the problem. */
  onMake: (request: TutorProblem) => void;
}

const MAX_ASK = 300;

const chip = (on: boolean) => `flex items-center gap-1.5 min-h-11 px-4 text-sm rounded-full border ${
  on ? 'text-white bg-gray-900 border-gray-900' : 'text-gray-900 bg-white border-gray-400 hover:bg-gray-50'}`;

/** + New → Problem from tutor: what the problem should be on, offered from the tutor memory. */
export default function TutorProblemDialog({ onClose, onMake }: Props) {
  const [topics, setTopics] = useState<TopicChoice[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  // '' is the tutor's choice; null until the memory has loaded and offered a first topic.
  const [topic, setTopic] = useState<string | null>(null);
  const [like, setLike] = useState('');
  const [ask, setAsk] = useState('');

  useEffect(() => {
    let active = true;
    loadProfile().catch(() => undefined).then((profile) => {
      if (!active) return;
      const offered = topicChoices(profile);
      setTopics(offered);
      setFavorites(favoriteChoices(profile));
      setTopic((picked) => picked ?? offered[0]?.name ?? '');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const make = () => onMake({
    topic: topic ?? '',
    ...(like ? { like } : {}),
    ...(ask.trim() ? { ask: ask.trim() } : {}),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form
        role="dialog"
        aria-label="Problem from tutor"
        onSubmit={(event) => { event.preventDefault(); make(); }}
        className="bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 p-6 max-h-[90vh] overflow-y-auto flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-indigo-700"><TutorIcon />Problem from tutor</h2>
          <p className="text-sm text-gray-600">The tutor writes one problem at your level and opens it on a new board. No hints or solution until you ask.</p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-gray-900">Topic</legend>
          <div className="flex flex-wrap gap-2">
            {topics.map((choice) => (
              <button key={choice.name} type="button" aria-pressed={topic === choice.name} onClick={() => setTopic(choice.name)} className={chip(topic === choice.name)}>
                {choice.name}{choice.label && <span className={topic === choice.name ? 'text-gray-300' : 'text-gray-600'}>· {choice.label}</span>}
              </button>
            ))}
            <button type="button" aria-pressed={topic === ''} onClick={() => setTopic('')} className={chip(topic === '')}>Tutor&apos;s choice</button>
          </div>
          <p className="text-xs text-gray-600">
            {topics.length
              ? 'From your tutor memory: topics you rated Rusty or Learning, and ones the tutor isn’t sure about yet.'
              : 'Rate topics in your tutor memory and they show here. Or name one below.'}
          </p>
        </fieldset>

        {favorites.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold text-gray-900">Like a favorite <span className="font-normal text-gray-600">(optional)</span></legend>
            <div className="flex flex-wrap gap-2">
              {favorites.map((title) => (
                <button key={title} type="button" aria-pressed={like === title} onClick={() => setLike((picked) => (picked === title ? '' : title))} className={chip(like === title)}>
                  <FavoriteStar filled />{title}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="tutor-problem-ask" className="text-sm font-semibold text-gray-900">Anything else? <span className="font-normal text-gray-600">(optional)</span></label>
          <input
            id="tutor-problem-ask"
            value={ask}
            maxLength={MAX_ASK}
            onChange={(event) => setAsk(event.target.value)}
            placeholder="e.g. harder than last time, a proof, something about contour integrals"
            className="min-h-11 px-3 text-sm border border-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 px-4 text-sm text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={topic === null} className="min-h-11 px-5 text-sm font-semibold text-white bg-indigo-700 border-2 border-indigo-700 rounded-lg hover:bg-indigo-800 disabled:opacity-50">
            Make problem
          </button>
        </div>
      </form>
    </div>
  );
}
