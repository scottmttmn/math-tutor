/** Opening the drawer is separate from asking, and stays available during a reply or rate limit. */
export async function openTutor(page) {
  const button = page.getByRole('button', { name: 'Ask tutor', exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.getByRole('complementary', { name: 'Tutor' }).waitFor();
}

export async function chooseTutor(page, label) {
  await openTutor(page);
  const choices = page.getByRole('group', { name: 'Tutor choices' });
  await (label ? choices.getByRole('button', { name: label, exact: true }) : choices.getByRole('button').first()).click();
}
