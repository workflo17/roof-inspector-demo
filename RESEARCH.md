# Roof inspection app: what it needs

Prepared 2026-10-11 for Kenneth Edwards's post "I need an app built for roof inspections" (Rough and Ready, CA). He is starting a roof inspection company and wants something like the app he used at a previous employer, but remembers only part of it. This note is what the research says an inspection app has to do, so the demo is built around the real workflow and not a guess.

Most sources are contractor and vendor pages. Treat their numbers as typical practice, not standards.

## Must-haves (every source agrees on these)

1. **Works with no signal.** Offline mode is the feature the software guides stress most. Photos and checklists are collected on the roof and synced when the phone is back in range. Sync conflicts are a known weak spot of existing apps, so test on a roof before trusting it. ([NRCIA, must-have features](https://www.nrcia.org/roof-inspection-software-features/), [Lumiform](https://lumiformapp.com/app-uses/roof-inspection-form))
2. **Organized by roof slope.** Reports break the roof into slopes (front, rear, left, right) plus components: chimney, vents and penetrations, gutters. Photos are grouped the same way, with a wide shot of each slope and close-ups of each finding. ([NRCIA report guide](https://www.nrcia.org/professional-roof-inspection-report/))
3. **A checklist that fits the roof.** A one-size form does not cover asphalt, metal and tile. The demo ships two templates (asphalt shingle, metal panel) to show the idea. ([GoCanvas](https://www.gocanvas.com/mobile-forms-apps/1232-Roof-Inspection-Checklist))
4. **Photos attached to the item they show, with markup.** Circles and arrows on the damage are how an inspector justifies a repair recommendation. Every photo needs a caption saying what it shows.
5. **A simple condition scale and a severity per finding.** Good / Fair / Poor is common for the overall roof. Each finding is then sorted into monitor, repair or replace. The demo uses Good / Watch / Fix per item. ([NRCIA report template](https://www.nrcia.org/roof-damage-inspection-report-template/))
6. **A report he can hand over.** Property and roof details (material, age, pitch, number of slopes, features), an overall summary, findings with photos by slope, prioritized recommendations, a limitations note and a signature. Delivered as a PDF with his branding.

## Storm and hail work (if he does insurance inspections)

- The **test square** is a 10 ft by 10 ft area chalked on each slope, with the functional hail hits counted inside it. Most contractor sources put the carrier threshold around 8 to 10 hits per square, but it varies by carrier, region and shingle type, so the app should record the count and never decide the outcome. ([Meridian](https://buildmeridian.com/hail-damage-roof/), [Royal Roofing](https://royalroofingandexteriors.com/how-many-hail-hits-to-replace-a-roof/))
- A claim-ready report adds the date and time, weather history showing a storm occurred, the photo of each marked square, per-slope counts, and measurements in roofing squares.
- Storm damage and age-related wear are described separately, and the report never makes coverage decisions.

## Scope and limits

- The InterNACHI home inspection standard has inspectors look at the roof covering, gutters, flashing, skylights, chimney and penetrations, describe the covering type, and flag active leaks. It does not require walking the roof, predicting remaining life, or inspecting areas that look unsafe. A "could not inspect, and why" option per area is worth having. ([InterNACHI standards](https://www.nachi.org/sop.htm))

## What the demo covers

| Need | In the demo |
| --- | --- |
| Offline | Installable, caches itself, photos and notes stored on the phone. Sync is simulated. |
| By slope | Tappable roof plan: four slopes plus chimney, vents, gutters |
| Template per roof | Asphalt shingle and metal panel checklists |
| Photos and markup | Camera capture, circle the damage, caption, stored per finding |
| Condition scale | Good / Watch / Fix per item, rolled up per area and overall |
| Hail | Test-square counter per slope (asphalt) |
| Report | Printable report with photos, recommendations, signature line, Save as PDF |

## Not in the demo (the real build)

- User accounts, a server, and real sync with conflict handling
- Editing the checklist templates; tile and flat-roof templates
- Email or text delivery of the report to the homeowner, e-signature
- "Could not inspect" with a reason, weather lookup for storm dates
- Estimates and roof measurements (usually bought from an aerial-measurement service, not built)

## Questions for Kenneth

1. What kinds of inspections: insurance and hail, pre-purchase, maintenance, post-storm?
2. Which roof materials, mostly asphalt?
3. Does he walk the roof, use a drone, or both?
4. Who receives the report, and does it need his logo and terms on it?
5. What did the old app do that he liked, and what drove him nuts?
6. How many inspections a week, and does anyone else inspect for him?
7. iPhone or Android?
