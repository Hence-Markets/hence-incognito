// The onboarding picks mirror (written by InterestsStep, read by the welcome tour so it
// personalizes before the profile round-trips — and for anon demo runs). The key lives in
// its own tiny module so AuthProvider can clear it on logout without importing a lazily
// loaded screen chunk.
export const PERSONA_KEY = 'hence.onboard.persona.v1';
