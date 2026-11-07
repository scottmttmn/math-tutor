// The ink board is the default (step 6). Tests of tldraw boards turn it off for their browser,
// unless the test has chosen already: pass to addInitScript before the first page loads.
export const keepTldraw = () => {
  if (localStorage.getItem('math-tutor:inkBoard') === null) localStorage.setItem('math-tutor:inkBoard', '0');
};
