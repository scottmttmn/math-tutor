import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const {
  TOPIC_AREAS, OWN_AREA, emptyProfile, isProfileEmpty, rateTopic, addOwnTopic, removeTopic, topicId, profileForTutor,
  noteTopic, setTutorLevel, forgetTutorNote, splitTutorNotes,
} = load('src/lib/learnerProfile.ts');

test('topic ids are unique and stable', () => {
  const ids = TOPIC_AREAS.flatMap(({ area, topics }) => topics.map((name) => topicId(area, name)));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(topicId('Calculus', 'Integration techniques'), 'calculus/integration-techniques');
});

test('rating a catalog topic adds it; clearing the rating removes it', () => {
  let profile = emptyProfile();
  assert.equal(isProfileEmpty(profile), true);
  profile = rateTopic(profile, 'Calculus', 'Derivatives', 'solid', 5);
  profile = rateTopic(profile, 'Algebra', 'Factoring', 'rusty', 6);
  assert.deepEqual(profile.topics.map((topic) => topic.name), ['Factoring', 'Derivatives']);
  assert.equal(profile.updatedAt, 6);
  assert.equal(isProfileEmpty(profile), false);
  profile = rateTopic(profile, 'Calculus', 'Derivatives', 'learning', 7);
  assert.equal(profile.topics.find((topic) => topic.name === 'Derivatives').rating, 'learning');
  profile = rateTopic(profile, 'Calculus', 'Derivatives', null, 8);
  assert.deepEqual(profile.topics.map((topic) => topic.name), ['Factoring']);
});

test("the student's own topics stay until removed, rated or not", () => {
  let profile = addOwnTopic(emptyProfile(), '  Fourier   series ', 1);
  assert.deepEqual(profile.topics, [{ id: topicId(OWN_AREA, 'Fourier series'), name: 'Fourier series', area: OWN_AREA, rating: null }]);
  assert.equal(addOwnTopic(profile, 'Fourier series'), profile);
  assert.equal(addOwnTopic(profile, '   '), profile);
  assert.equal(addOwnTopic(profile, 'FOURIER SERIES'), profile);
  // Names that slug alike, or have no ASCII letters, are still different topics.
  const own = ['C++', 'C#', 'Théorie de Galois', '群论'].reduce((current, name) => addOwnTopic(current, name), emptyProfile());
  assert.equal(new Set(own.topics.map((topic) => topic.id)).size, 4);
  assert.equal(isProfileEmpty(profile), true);
  profile = rateTopic(profile, OWN_AREA, 'Fourier series', 'learning', 2);
  profile = rateTopic(profile, OWN_AREA, 'Fourier series', null, 3);
  assert.equal(profile.topics.length, 1);
  profile = removeTopic(profile, topicId(OWN_AREA, 'Fourier series'), 4);
  assert.deepEqual(profile.topics, []);
});

test('the tutor reads the student\'s words and ratings, grouped, and nothing when sharing is off', () => {
  let profile = { ...emptyProfile(), aboutMe: '  Retired engineer relearning calculus for fun.  ' };
  profile = rateTopic(profile, 'Calculus', 'Derivatives', 'solid');
  profile = rateTopic(profile, 'Calculus', 'Limits', 'solid');
  profile = rateTopic(profile, 'Calculus', 'Infinite series', 'never');
  profile = addOwnTopic(profile, 'Fourier series');
  assert.equal(profileForTutor(profile), [
    "About me (in the student's words): Retired engineer relearning calculus for fun.",
    'How they rate their own knowledge:',
    '- Solid: Limits; Derivatives',
    '- Never seen: Infinite series',
  ].join('\n'));
  assert.equal(profileForTutor({ ...profile, shareWithTutor: false }), '');
  assert.equal(profileForTutor(emptyProfile()), '');
  assert.equal(profileForTutor(undefined), '');
});

test('catalog topic names are unique, so a note lands on one topic', () => {
  const names = TOPIC_AREAS.flatMap(({ topics }) => topics.map((name) => name.toLowerCase()));
  assert.equal(new Set(names).size, names.length);
});

test('the tutor\'s notes land on catalog or own topics, replace older ones, and can be corrected or forgotten', () => {
  let profile = rateTopic(emptyProfile(), 'Calculus', 'Limits', 'solid', 1);
  profile = noteTopic(profile, { topic: 'limits', level: 'rusty', confidence: 'medium', note: '  Sign errors   with one-sided limits ' }, 2);
  const limits = profile.topics.find((topic) => topic.name === 'Limits');
  assert.equal(limits.rating, 'solid');
  assert.deepEqual(limits.tutor, { level: 'rusty', confidence: 'medium', note: 'Sign errors with one-sided limits', updatedAt: 2 });
  assert.equal(limits.id, 'calculus/limits');

  // A catalog topic the student never rated, and one that isn't in the catalog.
  profile = noteTopic(profile, { topic: 'Integration techniques', level: 'learning', confidence: 'low', note: '' }, 3);
  profile = noteTopic(profile, { topic: 'Fourier series', level: 'never', confidence: 'high', note: 'First meeting' }, 4);
  assert.deepEqual(profile.topics.map((topic) => [topic.area, topic.name]), [['Calculus', 'Limits'], ['Calculus', 'Integration techniques'], [OWN_AREA, 'Fourier series']]);
  assert.equal(isProfileEmpty({ ...emptyProfile(), topics: profile.topics.slice(1) }), false);

  // A newer board replaces the note.
  profile = noteTopic(profile, { topic: 'Limits', level: 'solid', confidence: 'high', note: 'Clean epsilon-delta proof' }, 5);
  assert.equal(profile.topics.filter((topic) => topic.name === 'Limits').length, 1);
  assert.equal(profile.topics[0].tutor.level, 'solid');

  // The student corrects one and forgets others; clearing the rating keeps a noted catalog topic.
  profile = setTutorLevel(profile, 'calculus/integration-techniques', 'rusty', 6);
  assert.deepEqual(profile.topics[1].tutor, { level: 'rusty', confidence: 'low', note: '', updatedAt: 6, edited: true });
  profile = rateTopic(profile, 'Calculus', 'Limits', null, 7);
  assert.equal(profile.topics[0].tutor.note, 'Clean epsilon-delta proof');
  profile = forgetTutorNote(profile, 'calculus/limits', 8);
  profile = forgetTutorNote(profile, topicId(OWN_AREA, 'Fourier series'), 9);
  assert.deepEqual(profile.topics.map((topic) => [topic.name, Boolean(topic.tutor)]), [['Integration techniques', true], ['Fourier series', false]]);
});

test('the tutor reads its own notes back, newest first', () => {
  let profile = noteTopic(emptyProfile(), { topic: 'Limits', level: 'rusty', confidence: 'medium', note: 'Sign errors' }, 1);
  profile = noteTopic(profile, { topic: 'Factoring', level: 'solid', confidence: 'high', note: '' }, 2);
  profile = setTutorLevel(profile, 'calculus/limits', 'learning', 3);
  assert.equal(profileForTutor(profile), [
    'Your notes from their earlier boards (the student sees these and can correct them):',
    '- Limits: Learning (set by the student): Sign errors',
    '- Factoring: Solid (high confidence)',
  ].join('\n'));
});

test('topic notes are cut from the reply the student reads, also while it streams', () => {
  const reply = 'Good start. What happens to the sign?\n\n<memory>\n- Limits | Rusty | medium | Sign errors on one-sided limits\nFactoring | great | high | nope\nDerivatives | never seen | LOW |\n</memory>';
  const { visible, notes } = splitTutorNotes(reply);
  assert.equal(visible, 'Good start. What happens to the sign?');
  assert.deepEqual(notes, [
    { topic: 'Limits', level: 'rusty', confidence: 'medium', note: 'Sign errors on one-sided limits' },
    { topic: 'Derivatives', level: 'never', confidence: 'low', note: '' },
  ]);
  // Every streamed prefix shows a prefix of the final text, and never any of the block.
  for (let end = 0; end <= reply.length; end++) {
    const shown = splitTutorNotes(reply.slice(0, end)).visible;
    assert.ok(visible.startsWith(shown), JSON.stringify(shown));
  }
  assert.equal(splitTutorNotes('Try x = 2 <').visible, 'Try x = 2');
  assert.deepEqual(splitTutorNotes('No notes here.'), { visible: 'No notes here.', notes: [] });
});
