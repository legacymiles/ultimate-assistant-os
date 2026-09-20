# Worked example: the prompt adapted to one listing (from the video)

In the video (5:50–8:12) the presenter gave ChatGPT the source prompt and dictated a new
route. ChatGPT rewrote it for a single Zillow listing, 22510 La Quilla Dr, Chatsworth CA.
The presenter swapped in **Seedance 2** by hand and pasted the result into Lovable in
**Plan** mode, with the 8 listing photos attached.

The dictated route change, paraphrased: start with a drone shot over the backyard, pool and
sports courts. Fly around the back of the house and go in. Pass through the kitchen,
bathroom and living room. Come out the front door, turn 180° to reveal the whole house, and
end on a drone shot from the front. Use the listing URL for the facts.

Lines below were read off the screen. The prompt scrolled past quickly, so this is **not
complete**. `[…]` marks a gap. What is here is what the master template borrows from it.

---

Build me a cinematic luxury real estate website for the property below.

OFFICIAL PROPERTY LISTING
https://www.zillow.com/homedetails/22510-La-Quilla-Dr-Chatsworth-CA-91311/20199636_zpid/

I have also provided 8 reference images of the actual property.
Use the Zillow listing for all factual information.
Use my 8 uploaded images as the visual source of truth.
The entire website should feel like ONE continuous cinematic drone journey.
The visitor should feel like scrolling physically moves the camera through the property.
Do not make this feel like a traditional real estate website.
The cinematic experience IS the website.

FIRST STEP
Before building anything, inspect all 8 uploaded images.
Identify what each image shows.
Determine which images represent:
Backyard aerial view · Pool · Sports courts · Rear exterior · Kitchen · […]

[… listing facts to pull …]
Property description · Interior features · Exterior features · Pool and spa information ·
Sports amenities · Views · Kitchen details · Security information · Parking · Agent information ·
Any other facts that genuinely help sell this property
Never invent facts.
If Zillow changes the listing information, use the current information shown on the listing rather than hardcoded values.

HIGGSFIELD MCP
Use the Higgsfield MCP to create all cinematic motion.
Use the Seedance 2 cinematic image to video model currently available.   ← hand-edited by the presenter
Prioritize realism and architectural consistency over dramatic AI effects.
Use the uploaded property images as reference frames.
Do not redesign the property.
Do not change the architecture.
Do not move windows.
Do not change doors.
Do not change the pool.
Do not change the sports courts.
Do not replace furniture.
Do not change flooring.
Do not invent new rooms.
Do not change landscaping.
Do not create fake views.
The actual property must remain recognizable during the entire experience.
Generate in the highest practical resolution.
Use 16:9 cinematic footage for desktop.
Create optimized versions for mobile.
No audio.
If Higgsfield supports first frame and final frame control, use it aggressively.
If transition footage is needed between two supplied images, generate a short connecting sequence.
Keep camera direction consistent.
Keep architecture consistent.
Keep lighting believable.
The visitor should understand where they are inside the property.
Scrolling down moves forward through the journey.
Scrolling back up reverses the journey.

THE WEBSITE HAS ONLY 6 MAIN SECTIONS

SECTION 1 — BACKYARD DRONE HERO
Do NOT begin at the front of the house.
Begin high above the backyard.
Start with a wide drone view that immediately establishes the size of the estate.
The opening shot should show as much of the grounds as the supplied imagery […]
Minimal text should appear over the footage:
22510 La Quilla Dr
Chatsworth, California
Current Listing Price
Then quietly reveal a few major property numbers from Zillow.
Do not cover the property with text.

SECTION 2 — THE GROUNDS
Continue the same drone movement closer to ground level.
Move around the pool and outdoor spaces.
Show the relationship between the pool, home, landscaping, sports areas, outdoor entertaining spaces, and surrounding views.
Use scroll movement to progressively reveal the amenities.
Small factual callouts can appear when relevant.
Examples based only on confirmed listing facts could include: […] Security · Outdoor entertaining areas
Do not display them like boring feature cards.
Allow the facts to quietly appear over the environment and disappear as the camera continues moving.
Near the end of this section, turn the camera toward the rear of the residence.
Begin approaching the house.

SECTION 3 — […interior…]
Begin high and wide. Then slowly descend and fly across the property. Reveal the pool. Reveal the
landscaping. Reveal the outdoor entertaining areas. Reveal the sports courts visible in the supplied images.
If both basketball and tennis areas are genuinely shown, make sure both become part of the journey.
[…]

SECTION 5 — […front exit…]
As the camera turns, reveal the front architecture piece by piece.
The house should gradually enter the frame.
This should be one of the strongest cinematic moments on the entire website.

SECTION 6 — FRONT ESTATE DRONE FINALE
Complete the 180 degree rotation until the entire front of the residence is revealed.
Then begin moving backward.
As the visitor continues scrolling, transition from ground level camera movement into a drone pullback.
Rise higher. Move farther away.
Reveal more of the residence. Reveal the driveway. Reveal the grounds. Reveal the scale of the property.
End with a large aerial perspective from the FRONT side of the estate.
This creates a complete visual journey: […] 180 degree reveal. Drone finale.

[… performance …]
Reduce asset sizes where required.
Maintain smooth scroll behavior.
Keep text readable without covering the property.

FINAL VERIFICATION
Launch the website on localhost.
[…]
Mobile works.
There are no broken frames.
There are no impossible architecture changes.
There are no visual jumps.
There are no loading gaps.
There are no broken scroll animations.
Do not tell me the website is finished until the entire cinematic journey works from beginning to end in the browser.

---

## What Lovable's plan did with it (9:00)

The plan was titled "22510 La Quilla Dr — Scroll-Driven Cinematic Estate Film". It opened
with **"Your 8 images, mapped to the camera path"**, a table with the columns
`# | File | Shows | Role in journey`. Examples: backyard aerial → "Section 1 opening shot",
foyer → "interior hinge + Section 5 exit", facade at dusk → "Section 6 finale". It noted that no
bedroom photo existed, so it made no bedroom claim. It wrote the route as one line with no
teleporting, and planned "9 Higgsfield clips generated with Seedance 2.5 (… 1080p 16:9, no audio),
each anchored to your real …". Zillow blocked automated reads (HTTP 403), so it pulled the same
MLS record from a syndicated listing and stored the facts in one data file.

## What the finished site looked like (9:28–10:55)

- Full-bleed night and dusk footage the whole way. No cards, no nav bar, only a faint hairline top bar.
- The address sits bottom-left in a large light serif ("22510 La Quilla Dr"), with a tiny sans line
  under it for city and price.
- Chapter labels ("Pool and spa", "Full-size tennis court", "Château Loire") fade in on the right or in the
  centre in the same serif, then fade out as the camera moves on.
- Scrolling up plays the flight backwards.
- It ends on the front facade with the listing specs and a private-showing form over the footage.
