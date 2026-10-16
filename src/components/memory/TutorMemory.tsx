'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppBar from '@/components/layout/AppBar';
import { FavoriteStar, TutorIcon } from '@/components/common/Icons';
import MoreMenu from '@/components/common/MoreMenu';
import { useLearnerProfile } from '@/hooks/useLearnerProfile';
import { MAX_CHECK_IN_TOPICS, checkInCandidates, startCheckIn } from '@/lib/checkIn';
import {
  CONFIDENCES, MAX_ABOUT_ME, MAX_NOTEBOOK, OWN_AREA, RATINGS, TOPIC_AREAS, addOwnTopic, forgetTutorNote, profileForTutor, rateTopic,
  removeFavorite, removeTopic, setTutorLevel, topicId, writeNotebook,
} from '@/lib/learnerProfile';
import type { LearnerProfile, ProfileTopic, TopicRating, TutorNote } from '@/types';

function RatingButtons({ name, rating, onRate }: { name: string; rating: TopicRating | null; onRate: (rating: TopicRating | null) => void }) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-1">
      {RATINGS.map((option) => (
        <button
          key={option.rating}
          onClick={() => onRate(rating === option.rating ? null : option.rating)}
          aria-pressed={rating === option.rating}
          title={rating === option.rating ? 'Tap again to clear' : option.meaning}
          className={`min-h-11 px-2.5 text-sm rounded-lg border ${
            rating === option.rating ? 'font-semibold text-white bg-gray-900 border-gray-900' : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const levelLabel = (level: TopicRating) => RATINGS.find((option) => option.rating === level)?.label ?? level;

/** The tutor's read of a topic, with a menu to correct its level or forget it. */
function TutorNoteLine({ name, note, onLevel, onForget }: { name: string; note: TutorNote; onLevel: (level: TopicRating) => void; onForget: () => void }) {
  const how = note.edited ? 'set by you' : CONFIDENCES.find((option) => option.confidence === note.confidence)?.label;
  const when = new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <div data-testid={`tutor-note-${name}`} className="flex items-start gap-2 w-full pl-3 border-l-2 border-indigo-700">
      <p className="flex-1 text-sm text-gray-700">
        <span className="font-medium text-indigo-700">Tutor:</span> {levelLabel(note.level)}, {how} <span className="text-gray-500">· {when}</span>
        {note.note && <span className="block text-gray-600">{note.note}</span>}
      </p>
      <MoreMenu
        label={`Change the tutor's note on ${name}`}
        items={[
          ...RATINGS.filter((option) => option.rating !== note.level).map((option) => ({ label: `It's ${option.label}`, onSelect: () => onLevel(option.rating) })),
          { label: 'Forget this note', onSelect: onForget },
        ]}
      />
    </div>
  );
}

interface TopicActions {
  onRate: (rating: TopicRating | null) => void;
  onRemove?: () => void;
  onTutorLevel: (level: TopicRating) => void;
  onForget: () => void;
}

function TopicRow({ name, rating, tutor, onRate, onRemove, onTutorLevel, onForget }: { name: string; rating: TopicRating | null; tutor?: TutorNote } & TopicActions) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b border-gray-100 last:border-b-0">
      <span className="flex-1 min-w-[10rem] text-sm text-gray-900">{name}</span>
      <RatingButtons name={name} rating={rating} onRate={onRate} />
      {onRemove && (
        <button onClick={onRemove} aria-label={`Remove ${name}`} className="min-h-11 px-3 text-sm text-gray-700 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">
          Remove
        </button>
      )}
      {tutor && <TutorNoteLine name={name} note={tutor} onLevel={onTutorLevel} onForget={onForget} />}
    </li>
  );
}

const topicOf = (profile: LearnerProfile, area: string, name: string): ProfileTopic | undefined =>
  profile.topics.find((topic) => topic.id === topicId(area, name));

/** Starts a skill check-in on the topics the tutor (or the student) is least sure of. */
function CheckInSection({ profile, beforeStart }: { profile: LearnerProfile; beforeStart: () => Promise<unknown> }) {
  const router = useRouter();
  const candidates = checkInCandidates(profile);
  // Until the student picks, the first few are chosen.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = (picked ?? candidates.slice(0, MAX_CHECK_IN_TOPICS).map((topic) => topic.id)).filter((id) => candidates.some((topic) => topic.id === id));
  const toggle = (id: string) => setPicked(chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id]);

  const start = async () => {
    setStarting(true);
    setFailed(false);
    try {
      await beforeStart();
      await startCheckIn(candidates.filter((topic) => chosen.includes(topic.id)).map((topic) => topic.name));
      router.push('/board');
    } catch {
      setFailed(true);
      setStarting(false);
    }
  };

  return (
    <section aria-labelledby="check-in-heading" className="flex flex-col gap-2">
      <h2 id="check-in-heading" className="font-semibold text-gray-900">Skill check-in</h2>
      <p className="text-sm text-gray-600">
        Optional. The tutor gives you a few short problems on topics it isn&apos;t sure about, harder after a right answer and easier after a miss. You answer by hand on a board, and it notes each topic&apos;s level here.
      </p>
      {!profile.shareWithTutor ? (
        <p className="text-sm text-gray-700">Turn on sharing above to take a check-in: with it off, the tutor sees none of this and notes nothing.</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-gray-700">Nothing to check yet. Rate a few topics Rusty or Learning, or add your own, and they show here.</p>
      ) : (
        <>
          <fieldset className="bg-white border border-gray-200 rounded-lg px-3 py-1">
            <legend className="sr-only">Topics to check, at most {MAX_CHECK_IN_TOPICS}</legend>
            {candidates.map((topic) => (
              <label key={topic.id} className="flex items-center gap-3 min-h-11 text-sm text-gray-900">
                <input
                  type="checkbox"
                  checked={chosen.includes(topic.id)}
                  disabled={!chosen.includes(topic.id) && chosen.length >= MAX_CHECK_IN_TOPICS}
                  onChange={() => toggle(topic.id)}
                  className="w-5 h-5 accent-gray-900"
                />
                <span className="flex-1">{topic.name}</span>
                <span className="text-xs text-gray-500">{topic.area}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void start()}
              disabled={!chosen.length || starting}
              className="min-h-11 px-4 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-50"
            >
              {starting ? 'Starting…' : `Start check-in (${chosen.length} topic${chosen.length === 1 ? '' : 's'})`}
            </button>
            <span className="text-xs text-gray-500">Up to {MAX_CHECK_IN_TOPICS} topics, about 10 problems.</span>
          </div>
          {failed && <p role="alert" className="text-sm text-red-600">The check-in could not be started. Try again.</p>}
        </>
      )}
    </section>
  );
}

/** /memory: what the tutor knows about the student, written and rated by them. */
export default function TutorMemory() {
  const { profile, update, status, loadFailed, saveNow } = useLearnerProfile();
  const [newTopic, setNewTopic] = useState('');

  const addTopic = () => {
    update((current) => addOwnTopic(current, newTopic));
    setNewTopic('');
  };
  const actions = (area: string, name: string, id: string): TopicActions => ({
    onRate: (rating) => update((current) => rateTopic(current, area, name, rating)),
    onTutorLevel: (level) => update((current) => setTutorLevel(current, id, level)),
    onForget: () => update((current) => forgetTutorNote(current, id)),
  });
  const ownTopics = profile?.topics.filter((topic) => topic.area === OWN_AREA) ?? [];
  const preview = profile ? profileForTutor({ ...profile, shareWithTutor: true }) : '';

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <AppBar place="memory" beforeLeave={saveNow} />

      <main className="flex-1 w-full max-w-3xl mx-auto p-4 flex flex-col gap-6">
        <header className="flex flex-wrap items-start gap-2">
          <div className="flex-1 min-w-[16rem]">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><span className="text-indigo-700"><TutorIcon /></span>Tutor memory</h1>
            <p className="mt-1 text-sm text-gray-600">
              What the tutor knows about you. It reads this with every question, so its hints start at your level, and it notes here what your boards show about a topic. It stays on this device and in your backups, and all of it is optional.
            </p>
          </div>
          <span className="text-xs text-gray-500 pt-1" aria-live="polite">
            {status === 'saving' ? 'Saving…' : status === 'error' ? 'Not saved' : status === 'saved' ? 'Saved' : ''}
          </span>
        </header>

        {loadFailed ? (
          <p role="alert" className="text-sm text-red-600">Your tutor memory could not be loaded. Reload the page to try again.</p>
        ) : !profile ? null : (
          <>
            <label className="flex items-center gap-3 min-h-11 text-sm text-gray-900">
              <input
                type="checkbox"
                checked={profile.shareWithTutor}
                onChange={(event) => update((current) => ({ ...current, shareWithTutor: event.target.checked, updatedAt: Date.now() }))}
                className="w-5 h-5 accent-gray-900"
              />
              Share this with the tutor
              {!profile.shareWithTutor && <span className="text-gray-500">(off: the tutor sees none of it and takes no notes)</span>}
            </label>

            <section aria-labelledby="about-heading" className="flex flex-col gap-2">
              <h2 id="about-heading" className="font-semibold text-gray-900">About you</h2>
              <textarea
                value={profile.aboutMe}
                onChange={(event) => {
                  const aboutMe = event.target.value.slice(0, MAX_ABOUT_ME);
                  update((current) => ({ ...current, aboutMe, updatedAt: Date.now() }));
                }}
                rows={5}
                aria-label="About you"
                placeholder="What you're studying and why, what you enjoy, what you find hard, how you like to be helped…"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <p className="text-xs text-gray-500 text-right">{profile.aboutMe.length} / {MAX_ABOUT_ME}</p>
            </section>

            <section aria-labelledby="topics-heading" className="flex flex-col gap-3">
              <div>
                <h2 id="topics-heading" className="font-semibold text-gray-900">What you know</h2>
                <p className="text-sm text-gray-600">
                  Rate the topics you want the tutor to know about and skip the rest. Tap a rating again to clear it. The tutor&apos;s own notes show under a topic; use ⋯ to correct or forget one.
                </p>
              </div>
              {TOPIC_AREAS.map(({ area, topics }) => {
                const rated = topics.filter((name) => topicOf(profile, area, name)?.rating).length;
                const noted = topics.filter((name) => topicOf(profile, area, name)?.tutor).length;
                return (
                  <details key={area} open={rated + noted > 0} className="group bg-white border border-gray-200 rounded-lg">
                    <summary className="flex items-center gap-2 min-h-11 px-3 cursor-pointer list-none text-sm font-medium text-gray-900">
                      <span aria-hidden="true" className="w-3 text-gray-500 group-open:rotate-90">›</span>
                      <span className="flex-1">{area}</span>
                      {rated + noted > 0 && (
                        <span className="text-xs font-normal text-gray-500">
                          {[rated && `${rated} rated`, noted && `${noted} noted by the tutor`].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </summary>
                    <ul className="px-3 pb-1">
                      {topics.map((name) => {
                        const topic = topicOf(profile, area, name);
                        return (
                          <TopicRow
                            key={name}
                            name={name}
                            rating={topic?.rating ?? null}
                            tutor={topic?.tutor}
                            {...actions(area, name, topic?.id ?? topicId(area, name))}
                          />
                        );
                      })}
                    </ul>
                  </details>
                );
              })}

              <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
                <h3 className="min-h-11 flex items-center text-sm font-medium text-gray-900">{OWN_AREA}</h3>
                {ownTopics.length > 0 && (
                  <ul>
                    {ownTopics.map((topic) => (
                      <TopicRow
                        key={topic.id}
                        name={topic.name}
                        rating={topic.rating}
                        tutor={topic.tutor}
                        {...actions(OWN_AREA, topic.name, topic.id)}
                        onRemove={() => update((current) => removeTopic(current, topic.id))}
                      />
                    ))}
                  </ul>
                )}
                <form
                  onSubmit={(event) => { event.preventDefault(); addTopic(); }}
                  className="flex flex-wrap gap-2 py-2"
                >
                  <input
                    value={newTopic}
                    onChange={(event) => setNewTopic(event.target.value)}
                    aria-label="New topic"
                    placeholder="A topic that isn't listed, e.g. Fourier series"
                    className="flex-1 min-w-[12rem] min-h-11 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                  <button type="submit" disabled={!newTopic.trim()} className="min-h-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50">
                    Add topic
                  </button>
                </form>
              </div>
            </section>

            <section aria-labelledby="notebook-heading" className="flex flex-col gap-2">
              <h2 id="notebook-heading" className="flex items-center gap-2 font-semibold text-gray-900"><span className="text-indigo-700"><TutorIcon /></span>The tutor&apos;s notebook</h2>
              <p className="text-sm text-gray-600">
                What the tutor keeps in its own words about how you work and what you enjoy, rewritten as it learns more. Change anything you like; it reads your version from then on.
              </p>
              <textarea
                value={profile.notebook?.text ?? ''}
                onChange={(event) => { const text = event.target.value; update((current) => writeNotebook(current, text, true)); }}
                rows={6}
                aria-label="The tutor's notebook"
                placeholder="Empty for now. The tutor writes here once your boards show it something worth remembering."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <div className="flex items-center gap-3 text-xs text-gray-500">
                {profile.notebook && (
                  <span className="flex-1">
                    {profile.notebook.edited ? 'Last changed by you' : 'Last written by the tutor'} · {new Date(profile.notebook.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
                <span className="ml-auto">{profile.notebook?.text.length ?? 0} / {MAX_NOTEBOOK}</span>
              </div>
            </section>

            <section aria-labelledby="favorites-heading" className="flex flex-col gap-2">
              <h2 id="favorites-heading" className="flex items-center gap-2 font-semibold text-gray-900"><FavoriteStar filled />Your favorite problems</h2>
              <p className="text-sm text-gray-600">
                Problems you starred with Favorite on their board, and why if you said. The tutor reads all of them; one stays here even after its board is deleted.
              </p>
              {!profile.favorites?.length ? (
                <p className="text-sm text-gray-700">None yet. When a problem delights you, tap Favorite beside Mark solved.</p>
              ) : (
                <ul className="bg-white border border-gray-200 rounded-lg px-3">
                  {profile.favorites.map((favorite) => (
                    <li key={favorite.id} data-testid="favorite" className="flex items-start gap-2 py-2 border-b border-gray-100 last:border-b-0">
                      <div className="flex-1 min-w-0 text-sm">
                        <p className="font-medium text-gray-900">{favorite.title}</p>
                        {favorite.problem && favorite.problem !== favorite.title && <p className="text-gray-600 truncate">{favorite.problem}</p>}
                        {favorite.reason && <p className="text-gray-700">Why: {favorite.reason}</p>}
                      </div>
                      <MoreMenu
                        label={`Change the favorite ${favorite.title}`}
                        items={[{ label: 'Remove star', onSelect: () => update((current) => removeFavorite(current, favorite.id)) }]}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <CheckInSection profile={profile} beforeStart={saveNow} />

            <details className="group bg-white border border-gray-200 rounded-lg">
              <summary className="min-h-11 flex items-center gap-2 px-3 cursor-pointer list-none text-sm font-medium text-gray-900">
                <span aria-hidden="true" className="w-3 text-gray-500 group-open:rotate-90">›</span>What the tutor reads
              </summary>
              <pre data-testid="tutor-reads" className="px-3 pb-3 text-sm text-gray-700 whitespace-pre-wrap font-sans">
                {preview || 'Nothing yet. Write about yourself or rate a topic, and it shows here.'}
              </pre>
            </details>
          </>
        )}
      </main>
    </div>
  );
}
