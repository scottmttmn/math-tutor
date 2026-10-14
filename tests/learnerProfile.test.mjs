import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { TOPIC_AREAS, OWN_AREA, emptyProfile, isProfileEmpty, rateTopic, addOwnTopic, removeTopic, topicId, profileForTutor } = load('src/lib/learnerProfile.ts');

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
