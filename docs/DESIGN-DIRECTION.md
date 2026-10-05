# Taylor's 3D visual direction

Taylor supplied desktop and phone references on 5 October 2026. These describe the intended layout; they are not screenshots of the implemented card or evidence of connected household devices.

The house should be the main focus, with a large calm viewing area. Wide screens use room/device controls on the right; phones use a bottom sheet that leaves the house visible above it. Floor selection and everyday view actions stay within easy reach.

Use rounded dark panels, subtle borders and clear spacing. Amber identifies light controls and active floor/layer choices; teal identifies navigation and selected devices. Keep a usable light-theme counterpart, visible keyboard focus, readable contrast and touch targets of at least 44 pixels. Avoid making the editor or narrow screens scroll sideways.

The room panel should group supported controls clearly: room name and real current summary, light switch/brightness/colour choices, relevant media controls and saved scene choices. Device-specific controls appear when Home Assistant reports that capability. Scene preview and real activation remain separate deliberate actions.

The desktop reference also has weather, occupancy, security and an at-a-glance summary. Those must use explicitly configured/current Home Assistant entities. Missing or unavailable readings need clear labels. Do not insert the reference's sample address, car, charging percentage, music player, temperatures, people counts or alarm state as real household data.

Navigation should adapt to the card: a compact rail on a wide screen and reachable bottom controls on a phone. A Home Assistant page destination needs its actual configured path; a picture's button label alone cannot invent that route. Local card navigation can open the corresponding supported room/device controls.

Check the result using the simulated preview first, then Taylor's actual GLB and wall panel. Simulated screenshots must remain labelled. Preserve the separate integration/card identifiers, MIT credit, saved layouts, entity permissions and working controls while changing their presentation.

This direction applies to F18–F21 and the continuing visual configuration/polish work. The feature log distinguishes implemented behavior from remaining visual and household checks.
