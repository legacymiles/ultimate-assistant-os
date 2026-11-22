// ---------------------------------------------------------------------------
// The voices Phonon can speak with, bundled so the picker works with the local
// server off. Read from the `gradium/phonon-voices` catalog on 2026-11-18: the
// 37 English voices, in the catalog's own words.
//
// Bundled rather than fetched because the settings screen has to render before
// anything is running, and a picker that stays empty until a server answers
// reads as broken. The live list is still the truth (`GET /v1/voices` on the
// local server); a name here the catalog no longer has fails to preview out
// loud, rather than silently speaking as something else.
//
// Accent is deliberately NOT a field here. It is read out of the description by
// `accentOf`, because the description is the only place the catalog states one
// — and only 11 of the 37 do. Inventing the other 26 would be a lie the picker
// then sorts by.
// ---------------------------------------------------------------------------

export interface PhononVoice {
  name: string;
  /** The catalog's own description, shown to the owner as written. */
  description: string;
  /** A fictional being rather than a presenter - ogres, wizards, the Snow Queen. */
  character?: true;
}

export const VOICES: PhononVoice[] = [
  { name: "Zoey", description: "Playful, upbeat and Gen Z energy voice with a standard American accent. Perfect for engaging conversations!" },
  { name: "Juniper", description: "Cheerful presence with real resonance under it, personable when the copy turns intimate and decisive on the final line." },
  { name: "Everly", description: "Rounded, soft-edged tone with gentle lift at the end of phrases and an easy, relaxed delivery." },
  { name: "Harper", description: "Modern, confident and friendly voice with a standard American accent." },
  { name: "Hadley", description: "Settled, even-toned and genuinely kind, with crisp consonants that hold up over a handset." },
  { name: "Delia", description: "Low, grounded and quick to the point, with a sincerity that keeps an apology honest." },
  { name: "Easton", description: "Punchy and close in, with crisp consonant attack that cuts through a music bed and pitch that lifts across each line." },
  { name: "Micah", description: "Buoyant and high in energy, with a playful lift at the ends of phrases and clean attack that survives a loud mix." },
  { name: "Trevor", description: "Buoyant energy over a resonant mid-low core, phrases landing softly and consonants cutting through a handset." },
  { name: "Russell", description: "A high-energy American adult voice that pushes and encourages with the intensity of someone who genuinely believes in you." },
  { name: "Preston", description: "Trim, focused delivery with clean edges on every consonant and a steady, low-set core that carries through phone bandwidth." },
  { name: "Miles", description: "Resonant and decisive, with genuine dynamic range, dropping right down for one clause then driving back up." },
  { name: "Maeve", description: "A sparky, attentive British English adult voice that gets to the point with a smile. Ideal for fast, efficient customer support and helpful voice assistants." },
  { name: "Freya", description: "A young British voice, glossy and confident with fast, girly chatter and bubbly sparkle, perfect for a friendly receptionist or assistant." },
  { name: "Pippa", description: "A confident, upbeat British English adult voice with infectious energy. Perfect for proactive assistants and motivating customer success calls." },
  { name: "Elodie-Rose", description: "A young British voice with sharp, enthusiastic energy and crisp articulation, sparky and to the point for customer support and care." },
  { name: "Imogen", description: "A bubbly, friendly British English adult voice that puts callers instantly at ease. Great for onboarding assistants and warm concierge interactions." },
  { name: "Lottie", description: "Sparky and to the point, high forward energy with clean edges on the consonants and the range to drop low for one line then climb back." },
  { name: "Alfie", description: "Punchy and forward, with crisp consonant attack and a pitch that lifts across a line, sitting high over a music bed." },
  { name: "Hugh", description: "Soft and close, airy in texture, with lively pitch movement and an attentive, sincere delivery." },
  { name: "Edwin", description: "Efficient and firm, sincere in attention, with tidy articulation that holds up at phone bandwidth." },
  { name: "Spencer", description: "Light and airy, sitting a touch higher, with crisp consonants and a slow, patient delivery." },
  { name: "Toby", description: "A sparky, attentive British English adult voice that gets to the point with a smile. Ideal for fast, efficient customer support and helpful voice assistants." },
  { name: "Teddy", description: "Sparky and close in, quick off the mark, with firm consonants and the range to drop right down for a clause then come back up." },
  { name: "Bryony", description: "Full, rich mid-range tones, softly relaxed and spoken close to the mic, moving briskly with light pitch play." },
  { name: "Captain Silas Blackwater", description: "An old British pirate captain from the West Country, around sixty. Deep, gravelly and booming, rolling his Rs, salt-cracked from decades of shouting over gales. Roguish and hearty, with a wicked chuckle under every boast.", character: true },
  { name: "Morwenna of the Deep", description: "A sultry, seductive woman in her thirties. Low, husky alto, close to the microphone and almost whispered, slow and languid, purring, with a warm knowing smile in every word. Intimate, flirtatious and teasing, like a late-night torch singer luring someone closer, with a hint of danger underneath.", character: true },
  { name: "Old Mortlake", description: "An elderly gravedigger in a Victorian churchyard. Low, raspy and half whispered, melancholic, with heavy pauses that let every word settle like dirt on a coffin lid.", character: true },
  { name: "Azgorath", description: "An enormous ancient demon. A cavernous, impossibly deep bass voice that rumbles like stone grinding in a crypt, with a dry rasping edge and a faint hiss on every s. Calm, slow and amused, never shouting, every syllable set down deliberately, menace held under perfect control.", character: true },
  { name: "Fennick the Young Elf", description: "A curious, kind-hearted elf boy of about ten. A natural child's voice in a warm, soft middle range, never squeaky or shrill, earnest and wide-eyed, a little breathless with excitement, speaking quickly when amazed. Clean, close studio recording with no background noise or hiss.", character: true },
  { name: "The Thing Under the Stairs", description: "A monstrous creature lurking in the dark. Gravelly, breathy and pitched near the floor, a threatening growl that stays quiet to stay frightening, with a slow mocking sneer.", character: true },
  { name: "Vyrmathrax the Ancient", description: "An ancient dragon, thousands of years old. Very low and resonant, deep chest weight with gravel at the bottom of the register, slow and controlled with long pauses, dry and offhand, with the flat calm of something far too old to be impressed.", character: true },
  { name: "Grub the Ogre", description: "A big, good-natured ogre who lives under a bridge. Gruff and grainy, rumbling low end, heavy chest resonance, slow lumbering rhythm with loose rounded words, and warm humour sitting just under the grumble.", character: true },
  { name: "Master Aldric", description: "A wise old British wizard, around eighty. Rich and resonant with an aged grain, warm and kindly, deliberate pace with weighted pauses before the words that matter, able to rise into a ringing incantation.", character: true },
  { name: "The Snow Queen", description: "A regal, cold-hearted queen of ice. A cool, crystalline mezzo voice, poised and elegant, precise articulation, unhurried and quietly commanding, with an enigmatic chill and a faint smile that never warms.", character: true },
  { name: "Sir Bramwell", description: "A brave but pompous English knight, middle-aged. Booming, plummy and theatrical, full of puffed-up self-importance, rolling grand phrases, with a comic wobble of nerves showing through the bravado.", character: true },
  { name: "Fairy Godmother", description: "A kind fairy godmother, an older woman in her sixties. A low, warm, velvety alto voice, cosy and grandmotherly, unhurried and soothing, with a soft rich chuckle and a twinkle in every word. Gentle and reassuring, never high, never thin.", character: true },
];
