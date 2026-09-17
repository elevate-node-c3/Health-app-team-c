# Sprint 2 — Discovery: Home, Search and Filters

**Project:** DOCURA — Doctor Appointment Booking Platform (Bootcamp Project 2)
**Requirements:** [`requirements.md`](./requirements.md)
**Previous sprint:** [`sprint-1-auth-stories.md`](./sprint-1-auth-stories.md)
**Design:** [Figma — Healthy App](https://www.figma.com/design/KyofGEsVa9H2FrxIjQnGKV/Healthy-App?node-id=1171-4322)
**Jira import file:** [`sprint-2-catalog-stories.csv`](./sprint-2-catalog-stories.csv)

---

## How to read these stories

Same contract as Sprint 1: each story is **a user flow across real screens**, followed by the rules that flow must obey, the events it must publish, the edge cases it must survive, and the acceptance criteria you are graded on.

Still **not** provided: endpoint paths, query parameter names, table names, field lists. Derive them from the flow, the rules and the Figma. When a rule says *"decide what 'Most Recommended' means and document it"*, the deciding is the assignment.

**What is new this sprint:** this is where your data model meets reality. Sprint 1 was mostly writes on one table. Sprint 2 is reads — filtered, sorted, paged, joined and geographic — across a catalogue big enough to hurt. Several acceptance criteria are about **speed and query shape**, not just correctness. A feature that returns the right doctors by loading every doctor into memory does not pass.

---

## Importing into Jira

**Jira → Settings → System → External System Import → CSV**, then map:

| CSV column | Jira field |
|---|---|
| Issue Type | Issue Type |
| Issue Key | *do not map* (local reference only) |
| Summary | Summary |
| Description | Description |
| Acceptance Criteria | Acceptance Criteria custom field, or append to Description |
| Priority | Priority |
| Labels | Labels (split on comma) |
| Story Points | Story point estimate |
| Epic Name | Epic Name (company-managed only) |
| Epic Link | Parent (team-managed) / Epic Link (company-managed) |
| Component | Components |
| Sprint | Sprint |

Keep the file order — the Epic row must import first.

---

## Sprint at a glance

**7 stories · 36 points**

| # | Story | Points |
|---|---|---|
| CAT-1 | The doctor catalogue — specialties, doctors, clinics and what they charge | 5 |
| CAT-2 | Home screen — everything a user sees when the app opens | 5 |
| CAT-3 | Search — suggestions that know a specialty from a doctor, and remembered searches | 5 |
| CAT-4 | Search results, sorting and the empty state | 5 |
| CAT-5 | Filters — nine ways to narrow the list, including real availability | 8 |
| CAT-6 | Map view — doctors near me, with real distances | 5 |
| CAT-7 | Favourite a doctor — and let the rest of the system find out through an event | 3 |

### Suggested order

```
CAT-1  Catalogue + seed data   ── nothing else can start without it
   │
   ├─▶ CAT-2  Home screen
   ├─▶ CAT-3  Search suggestions + history
   │      └─▶ CAT-4  Results, sorting, empty state
   │             └─▶ CAT-5  Filters        (the hardest story — start it early)
   │                    └─▶ CAT-6  Map view (filters apply here too)
   └─▶ CAT-7  Favourites  (small, but it is the reference example for events)
```

Build **CAT-1 first and properly**. Every other story reads from it, and a model that puts the consultation fee on the doctor instead of on the doctor-and-clinic pairing will have to be rebuilt in the middle of CAT-5.

### What carries over from Sprint 1

| Sprint 1 story | Used here by |
|---|---|
| AUTH-1 guest identity | CAT-2 guest Home · CAT-3 guest search history · CAT-7 blocking guests |
| AUTH-5 sessions and access levels | CAT-2 personal sections · CAT-7 signed-in only |
| AUTH-6 guest migration | CAT-3 search history surviving registration |

### Definition of Done (every story)

- Every rule listed in the story is enforced **on the server**, not by the mobile app.
- Every acceptance criterion has a test — including the negative ones.
- Every edge case listed has a deliberate, defined behaviour.
- The events listed are published, and their consumers live outside the code that publishes them.
- Queries are measured against the **seeded catalogue**, not against five rows, and the query plan is checked rather than guessed.
- Errors use your shared response envelope and documented error codes.
- The endpoints you invented are in your API table, reviewed with your mentor.

---

## CAT-0 — Epic: CATALOG — Discovery: Home, Search and Filters

Everything a patient does before they choose a time: the Home screen, searching by
specialty or doctor name, narrowing with filters, sorting, browsing on a map, and saving
a doctor for later.

Source of truth: the Figma Home, Search, Results, Sort, Filter, Empty and Map screens,
plus sections 4 (Module 2), 5.2, 5.5 and 6.3 of the project requirements document.

Scope note: the doctor PROFILE screen, availability and booking are Sprint 3. This sprint
stops at the point where the user has found the doctor they want.

Depends on Sprint 1: guest identity (AUTH-1), sessions (AUTH-5) and guest migration
(AUTH-6) are all used here.

**Epic acceptance criteria**

- Home renders for both a guest and a signed-in user, in one request, with the right sections for each.
- A user can search one box and get back both specialties and doctors, clearly distinguished.
- Results can be filtered on nine dimensions, sorted three ways, and paged without repeating or losing doctors.
- "Available today/tomorrow" reflects real free slots, not a flag.
- The map returns nearby doctors with server-computed distances, and still works without a location.
- Favouriting publishes an event and the notification is written by a separate consumer.
- Every query is fast on a realistically seeded catalogue, and a test demonstrates it.

---

## CAT-1 — The doctor catalogue — specialties, doctors, clinics and what they charge

**5 points · Priority Highest · `catalog,foundation,sprint-2`**

### User story
As the platform
I need doctors, their specialties, the clinics they work at and what they charge there
So that every screen in this sprint has something real to show

### User flow (see Figma)
This story has no screen of its own. It is the data every other story in Sprint 2 reads.

Open the Figma doctor cards and the doctor profile screen and write down every fact shown:
photo, name, title, specialty, rating, consultation fee, clinic name, area, university,
years of experience, number of patients, subspecialties. That list is your starting point.

Pay attention to one detail on the profile screen: the doctor has a row of CLINIC TABS,
and switching tabs changes the schedule. That tells you something important about where
the fee and the working hours actually live.

### Rules and validations
- Fee and schedule belong to the pairing: A doctor's consultation fee and working hours belong to the doctor AND the clinic together, not to the doctor alone. The same doctor may charge 200 EGP at one clinic and 350 EGP at another (BR-10). A model that puts the fee on the doctor will fail this sprint.
- One price on the card: Home and search results show ONE price per doctor, but a doctor may have three. Decide which one is shown (cheapest? nearest? default clinic?), apply it consistently everywhere, and be ready to defend the choice.
- Ratings are read constantly: Every doctor card and every sorted list reads the rating. Recomputing an average from all reviews on every request will not survive a realistic dataset — decide how the rating is kept ready to read, and what happens when a new review arrives.
- Place types: A clinic is one of: clinic, centre, or hospital. This is what the Place filter searches on.
- Titles: A doctor's title is one of: Professor, Consultant, Specialist. This is a separate thing from their specialty.
- Location: A clinic belongs to a governorate and a city inside it, and has a physical position on the map. Both matter: the filter uses the administrative location, the map uses the position.
- Only real doctors appear: A doctor who is not verified, or a clinic pairing that is no longer active, must not appear in Home, search, filters or the map.
- Seed realistically: Seed at least 50 doctors across at least 8 specialties, several governorates and cities, with varied fees (including some above 1000 EGP), varied ratings and multi-clinic doctors. You cannot test search, sorting or filtering with five records.

### Domain events to publish
- A doctor's rating changed (so anything that caches or ranks by rating can react).

### Edge cases to handle
- A doctor works at three clinics with three different fees — which one does the Home card show, and does search sorting by price agree with it?
- A doctor changes specialty after patients have already booked them.
- A clinic is closed permanently while its doctors are still listed.
- A doctor has no reviews yet — what rating does the card show, and where do they land when sorting by rating?

### Acceptance criteria

- Given the seeded data, when a doctor works at three clinics, then three different fees can exist for that one doctor and each is attached to the right clinic.
- Given a doctor card is rendered anywhere in the app, when a price is shown, then it is chosen by one documented rule applied identically on Home, in search results and on the map.
- Given a new review is added for a doctor, when their card is next shown, then the rating reflects it without the request recomputing an average over every review.
- Given an unverified doctor or an inactive doctor-clinic pairing, when any listing is requested, then it does not appear.
- Given the seed script is run on an empty database, when it finishes, then there are at least 50 doctors across at least 8 specialties, multiple governorates, varied ratings, fees both under and over 1000 EGP, and at least 5 doctors working at more than one clinic.
- Given the seed script is run twice, when it finishes, then the data is not duplicated.

---

## CAT-2 — Home screen — everything a user sees when the app opens

**5 points · Priority Highest · `catalog,home,sprint-2`**

### User story
As a patient opening the app
I want one screen that greets me, shows me specialties, good doctors and my next appointment
So that I can start finding care without searching first

### User flow (see Figma)
Sign in (or continue as guest) -> Home.

Top to bottom, from the Figma:
  1. Greeting with the time of day and the user's name, plus a notification bell
  2. Search bar ("Search by doctor name or specialty") with a filter button beside it
  3. Categories — specialty chips (Neurology, Cardiology, Orthopedic, Dentist...) + "See All"
  4. Upcoming Appointment and My Recent Visit — ONLY for signed-in users who have them
  5. Top Doctors — cards with photo, name, specialty, rating, fee and a favourite heart
  6. "Have a medical question? Ask a doctor anonymously for free..." banner -> Ask now
  7. Medical Articles + "See All" -> articles list -> article detail

Compare the two Home screens in the Figma: the first-time one has no appointment section,
the returning one does. That difference is a requirement, not a coincidence.

### Rules and validations
- One screen, one request: Home is assembled server-side and delivered in one response. The app must not make six calls to paint one screen.
- Greeting: The greeting changes with the time of day in the user's local timezone (Africa/Cairo). A guest is greeted without a name.
- Guest vs signed-in: A guest's Home has no appointment sections and no favourite state. Do not send empty placeholders the app has to special-case — a guest's Home simply does not contain them (BR-09).
- Upcoming appointment: Shown only when the signed-in user actually has a future appointment. A user with none does not see an empty section.
- Top Doctors: A ranked list — decide what makes a doctor 'top' (rating, number of patients, availability, or a mix), document it, and keep it stable so the same doctors do not shuffle on every refresh.
- Favourite state: For a signed-in user, each doctor card knows whether they have already favourited that doctor. A guest's cards carry no favourite state.
- Articles: The Home teaser shows the newest published articles. 'See All' opens the full list, and each article has a detail view. Unpublished articles never appear.
- Price and rating: Every card shows the fee in EGP and the rating, using the same rules as CAT-1.
- Speed: Home is the most requested screen in the product. The public parts (specialties, top doctors, articles) are the same for everybody — treat them accordingly. The personal parts are never shared between users.

### Domain events to publish
- A user opened Home (for analytics — it must not slow the response).

### Edge cases to handle
- A guest's Home is served, then the same device signs in seconds later — the personal sections must appear, and the guest response must never have been cached against the user.
- A user's only upcoming appointment is cancelled from another device while Home is open.
- A doctor in the Top Doctors list is deactivated between two refreshes.
- There are fewer articles or doctors than a section expects.

### Acceptance criteria

- Given a signed-in user with an upcoming appointment, when they open Home, then one response contains the greeting with their name, specialties, their upcoming appointment, their recent visit, top doctors, the ask banner and the articles teaser.
- Given a guest, when they open Home, then the response has no appointment sections, no recent visit and no favourite state, and nothing in it identifies a user.
- Given a signed-in user with no appointments at all, when they open Home, then the appointment sections are absent rather than empty.
- Given a user opens Home at 9am and again at 8pm, when each response is built, then the greeting matches the time of day in Cairo.
- Given a signed-in user who has favourited a doctor, when that doctor appears on Home, then the card shows as favourited.
- Given the same user refreshes Home twice within a minute, when both responses are compared, then the Top Doctors order is the same.
- Given an article that is not published, when Home or the articles list is requested, then it does not appear.
- Given Home is requested repeatedly, when the responses are measured, then the shared parts are not rebuilt from scratch on every request, and no user ever receives another user's personal section.

---

## CAT-3 — Search — suggestions that know a specialty from a doctor, and remembered searches

**5 points · Priority Highest · `catalog,search,sprint-2`**

### User story
As a patient who half-knows what I need
I want the search box to understand both "dentistry" and "Sara Mahmoud"
So that I do not have to know whether I am searching for a condition or a person

### User flow (see Figma)
Home -> tap the search bar -> Search screen.

Empty state: the search field plus SEARCH HISTORY — the user's own recent terms shown as
chips. In the Figma these mix both kinds: "Ahmed Khaled", "Sara Mahmoud", "Cardiology",
"Pediatrics", "Orthopedics".

As the user types: live suggestions appear, GROUPED AND LABELLED BY TYPE. Typing "Den"
returns "Dentistry — Speciality", "Dental Procedures — Speciality", then
"Sara Mahmoud — Doctor", "Kareem Ahmed — Doctor".

Tapping a suggestion or submitting the text goes to the results screen (CAT-4).

### Rules and validations
- Two kinds of result: One query resolves against two different things — specialties and doctor names — and every suggestion says which one it is (BR-33). The app renders the label; the backend decides the type.
- Ordering: Specialties come before doctors, and closer matches before looser ones. Decide what 'closer' means and make it repeatable.
- Partial and forgiving: Matching is partial and case-insensitive, and works on any part of a name — 'mahmoud' finds 'Sara Mahmoud'. Decide whether you handle Arabic input and small typos, and say so.
- Fast: Suggestions are requested on almost every keystroke. They must stay fast as the catalogue grows, which is a question about how the data is indexed, not about how the code is written. Very short queries (one character) may be refused rather than served slowly.
- History belongs to someone: A search is remembered for whoever ran it — the signed-in user, or the guest's device (AUTH-1). Guests get history too, and it follows them into their account (AUTH-6).
- History is short and unique: Only recent terms are kept, newest first, with no duplicates — searching the same thing twice moves it up rather than adding a second chip.
- History is deletable: The user can clear their history, and clearing it removes it, not just hides it.
- Nothing personal leaks: One user's history is never visible to another, and history is never used to rank another user's results.

### Domain events to publish
- A search was performed (feeds analytics and the history writer — the response must not wait for either).

### Edge cases to handle
- The user types faster than the responses return — a stale suggestion response arrives after a newer one.
- A doctor in the history is deactivated before the user taps the chip again.
- A search term is 500 characters long, or contains characters that mean something in your query language.
- A guest device is shared by two people.

### Acceptance criteria

- Given the catalogue is seeded, when the user types 'Den', then the suggestions contain both matching specialties and matching doctors, each labelled with its type, specialties first.
- Given a user types 'mahmoud' in lower case, when suggestions return, then 'Sara Mahmoud' is among them.
- Given a single character is typed, when the request is made, then the documented behaviour happens (served or refused) and it is consistent.
- Given a query matching nothing, when suggestions return, then the result is a well-formed empty list, never an error.
- Given a signed-in user runs a search, when they reopen the search screen, then that term appears in their history, newest first.
- Given a user searches the same term twice, when their history is shown, then it appears once and at the top.
- Given a guest runs searches and then registers, when they open search again, then their earlier terms are still there (verified together with AUTH-6).
- Given user A's history, when user B searches, then nothing of A's appears and A's history does not influence B's results.
- Given a user clears their history, when they reopen search, then it is empty and remains empty after restarting the app.
- Given the catalogue holds the full seeded dataset, when suggestions are requested, then the response time stays within the budget you documented, and a test demonstrates it.

---

## CAT-4 — Search results, sorting and the empty state

**5 points · Priority Highest · `catalog,search,sorting,sprint-2`**

### User story
As a patient who has searched
I want a list of matching doctors I can re-order by what matters to me
So that I can compare them and pick one

### User flow (see Figma)
Search -> results screen "Search Result":
  the query shown as a chip, a FILTER button and a SORT button, a horizontal specialty
  strip with "See All", then the doctor cards — name, specialty, rating, fee.

SORT opens a sheet with a single choice and a "Reset":
  Most Recommended (default) · Price Low To High · Price High to Low

When nothing matches, the design shows a specific EMPTY STATE — and note carefully that
the Filter, Sort and specialty controls are STILL THERE. The user must be able to widen
the search without starting over.

The same results screen is reached from Home by tapping a Category chip or "See All".

### Rules and validations
- One list, many entry points: A category tap, a 'See All', a typed query and a chosen suggestion all lead to the same list with different inputs. Build one thing, not four.
- Sorting: Three options: Most Recommended (the default), price ascending, price descending. Sorting by price uses the same price the card displays (CAT-1).
- Most Recommended: Define it. Rating, availability, distance when known, popularity — some mix. Write down the terms, because 'recommended' with no definition is not testable.
- Stable order: Two doctors with the same rating or the same fee must always come back in the same order. An unstable sort makes paging repeat or skip doctors — this is the classic bug in this story.
- Paging: The list is paged. The user scrolls; results must not repeat or vanish between pages, including while sorting is applied.
- Empty is not an error: No matches returns a normal, well-formed empty result. The app shows the designed empty state (BR-34 still applies — the filters remain usable).
- Only bookable doctors: Deactivated doctors and inactive clinic pairings never appear (CAT-1).
- No N+1: Rendering 20 cards must not cost 20 extra queries for ratings, fees or clinics. Prove it.

### Domain events to publish
- A result list was viewed with its query and sort (analytics only — never on the request's critical path).

### Edge cases to handle
- A doctor's fee changes between page 1 and page 2 while the user is sorting by price.
- A doctor is deactivated between two pages.
- The user asks for page 500 of a 3-page result.
- Two doctors have identical names.

### Acceptance criteria

- Given a query matching several doctors, when results return, then each card carries name, specialty, rating and fee, and the list is paged.
- Given sort is Price Low To High, when results return, then they are ordered by the displayed price ascending, and the reverse for Price High to Low.
- Given no sort is chosen, when results return, then Most Recommended is applied, and its definition is documented.
- Given several doctors share the same fee, when the same page is requested twice, then their order is identical both times.
- Given the user pages through all results, when the pages are combined, then no doctor appears twice and none is missing.
- Given a query that matches nothing, when results return, then the response is a well-formed empty list and the app can still change filters, sort and specialty.
- Given a user reaches results by tapping a Category chip, when results return, then they are the same shape as results reached by typing.
- Given a page of 20 results, when the query is traced, then the number of database round trips does not grow with the number of doctors on the page.
- Given a deactivated doctor matches the query text, when results return, then they are absent.

---

## CAT-5 — Filters — nine ways to narrow the list, including real availability

**8 points · Priority Highest · `catalog,filters,sprint-2`**

### User story
As a patient with constraints
I want to narrow doctors by gender, availability, place, title, location, specialty, price and rating
So that what I see is what I could actually book

### User flow (see Figma)
Results -> FILTER -> the filter sheet. From the Figma, top to bottom:

  Doctor Gender   checkboxes   Male · Female
  Availability    checkboxes   Any Day · Today · Tomorrow
  Place           checkboxes   Clinic · Center · Hospital
  Title           checkboxes   Professor · Consultant · Specialist
  Governorate     dropdown
  City            dropdown
  Specialty       dropdown
  Price range     Min / Max inputs and a slider from 0 EGP to 1000 EGP
  Rating          radio        All · 1 to 5 stars

  Buttons: Cancel · Apply

Applying returns to the results list with the filters active. The user can come back and
change them, and can leave the doctor profile and return without losing them.

### Rules and validations
- Empty group means no constraint: A group with nothing ticked does not filter. Ticking Male and Female is the same as ticking neither.
- Multi-select vs single: Gender, Availability, Place and Title allow several values at once. Rating is a single choice.
- Rating means 'and above': Choosing 3 stars means 3 or more, not exactly 3 (BR-35).
- Availability is the hard one: 'Today' and 'Tomorrow' must exclude doctors with no free slot in that window (BR-34). This is a real availability question, not a flag on the doctor — a doctor whose day is fully booked is not available today. 'Today' and 'Tomorrow' are judged in Africa/Cairo, not in UTC.
- City belongs to a governorate: Choosing a city that is not inside the chosen governorate is rejected, not silently ignored.
- Price: Min must not exceed Max. The maximum of 1000 EGP means 1000 AND ABOVE — a doctor charging 1500 is still found (BR-19, D12). Prices are EGP (BR-36).
- The server decides: Every filter is applied by the server. The app never receives a longer list and trims it.
- Filters survive the journey: Filters are expressed in the request itself, so opening a doctor and coming back does not lose them, and a filtered list can be shared or reopened.
- Filters and sort compose: Any combination of filters works together with any sort and with paging. All three at once is the case that breaks naive implementations.
- Invalid input is refused: An unknown gender, an unknown place type, a rating of 9, a negative price — each is rejected with a clear error naming the field, not quietly dropped.

### Domain events to publish
- A filter set was applied (analytics — which filters people actually use is a product question worth answering).

### Edge cases to handle
- Every filter is applied at once and nothing matches — can the user recover without restarting?
- A doctor's last free slot today is booked by someone else one second after the filtered list was built.
- A filter is applied while the user has no internet and retries later.
- A specialty is deleted while it is selected in someone's active filter.
- Someone hand-crafts a request with twenty filter values to make the query expensive.

### Acceptance criteria

- Given no filters are ticked in a group, when results return, then that group does not narrow the list.
- Given Male and Female are both ticked, when results return, then the list matches the unfiltered list.
- Given a minimum rating of 3, when results return, then every doctor has a rating of 3 or more.
- Given Availability is Today and a doctor's every slot today is taken, when results return, then that doctor is absent.
- Given Availability is Tomorrow near midnight Cairo time, when results return, then 'tomorrow' is judged in Cairo, not UTC.
- Given a city that does not belong to the chosen governorate, when the filter is applied, then the request is rejected with an error naming the field.
- Given a price minimum greater than the maximum, when the filter is applied, then it is rejected with an error naming the field.
- Given the price maximum is 1000, when results return, then doctors charging more than 1000 are still included.
- Given filters, a sort and paging are combined, when every page is walked, then results are correct, ordered and free of duplicates.
- Given a user applies filters, opens a doctor and returns, when the list is shown, then the same filters are still applied.
- Given an unknown value for any filter, when the request arrives, then it is rejected with a field-level error rather than ignored.
- Given a filter combination matching nothing, when results return, then the empty state is returned and the filters can still be changed (with CAT-4).
- Given the fully seeded catalogue, when a heavily filtered and sorted query runs, then it stays within your documented time budget and the query plan does not scan the whole table.

---

## CAT-6 — Map view — doctors near me, with real distances

**5 points · Priority High · `catalog,map,location,sprint-2`**

### User story
As a patient who will have to travel to the clinic
I want to see doctors on a map with how far away they are
So that I can choose one close to me

### User flow (see Figma)
Search or results -> map view.

From the Figma: a full-screen map, a "Search this area" action at the top, a my-location
button, pins LABELLED WITH A DISTANCE (1.1km, 1.2km, 1.3km — one highlighted as selected),
and a horizontally scrollable strip of doctor cards at the bottom.

Tapping a pin selects the matching card. "Search this area" re-queries the region the user
is currently looking at, not the place they started from.

### Rules and validations
- Distance is computed by the server: The pin labels come from the backend, calculated from the user's position to each clinic. The app does not compute them.
- Position is per clinic, not per doctor: A doctor with three clinics can appear at three places on the map — decide how you handle that and document it.
- Search this area: The query is bounded by the region the user is viewing, and re-running it after panning returns the doctors in the new region.
- Filters still apply: Everything from CAT-5 applies on the map too. The map is another view of the same search, not a separate feature.
- No location, no distance: If the user has not shared their position, results are still returned — without distances. Refusing to answer is not acceptable.
- Bounded results: A region can contain thousands of clinics. Cap what is returned and decide what the cap means for the user.
- Geography must be indexed: Scanning every clinic to find the ones inside a region will not scale. This is a database capability question, not an application-code one.

### Domain events to publish
- A map region was searched (analytics).

### Edge cases to handle
- The user denies location permission but the screen still wants distances.
- The user is outside Egypt, or their position is wildly wrong.
- The user zooms out to the whole country.
- Two clinics sit at nearly the same coordinates.
- A clinic has no coordinates recorded at all.

### Acceptance criteria

- Given a user position and a map region, when the map is requested, then each returned doctor carries a distance from that position, computed server-side.
- Given no user position is supplied, when the map is requested, then doctors are still returned, without distances, and nothing fails.
- Given the user pans and taps 'Search this area', when the request is made, then the results match the new region and not the original one.
- Given filters are active, when the map is requested, then the same filters narrow the map results exactly as they narrow the list.
- Given a region containing more clinics than the cap, when results return, then the number is capped and the response makes that clear.
- Given a doctor works at clinics in two different regions, when each region is queried, then the documented behaviour happens consistently.
- Given a region query on the full seeded dataset, when it runs, then it uses a geographic index rather than scanning every clinic.
- Given an invalid region (impossible coordinates, inverted bounds), when it is submitted, then it is rejected with a clear error.

---

## CAT-7 — Favourite a doctor — and let the rest of the system find out through an event

**3 points · Priority Medium · `catalog,favorites,events,sprint-2`**

### User story
As a signed-in patient
I want to save a doctor I like
So that I can find them again without searching

### User flow (see Figma)
Any doctor card (Home, search results, map, profile) has a HEART.

A signed-in user taps it -> the doctor is favourited, and the heart stays filled everywhere
that doctor appears. Tapping again removes it.

A guest taps it -> they are sent to sign in (AUTH-1).

In the Figma's Notifications screen there is an entry: "Dr.Omar Ahmed has been added to
favorite". That notification is NOT written by the favourite code. Favouriting publishes
an event; something else listens and creates the notification. This story is the smallest
place in the project to get that separation right, so treat it as the reference example.

### Rules and validations
- Signed-in only: Favouriting requires an account (BR-37). A guest's attempt is refused and the app routes them to sign in.
- Idempotent: Favouriting the same doctor twice leaves one favourite, not two. Unfavouriting something that was never favourited is not an error.
- Consistent everywhere: Once favourited, the doctor shows as favourited on Home, in results, on the map and on their profile — from the same source of truth.
- Owned: A user's favourites are theirs alone and are never visible to anyone else.
- Event-driven, not inline: The favourite is saved and a 'doctor was favourited' event is published. The notification is created by a SEPARATE consumer of that event. The favourite code must contain no reference to notifications.
- A failing consumer breaks nothing: If the notification consumer throws, the favourite is still saved and the user still sees the filled heart.
- Consumers do not double-fire: The same event delivered twice must not produce two notifications.

### Domain events to publish
- A doctor was favourited (consumed by the notification writer).
- A doctor was unfavourited.

### Edge cases to handle
- A favourited doctor is later deactivated — what does the user's favourites list show?
- The same doctor is favourited from two devices at the same moment.
- A guest favourites, signs up, and expects the favourite to be there (decide and document).
- The notification consumer is down for an hour and then comes back — do the queued notifications still arrive?

### Acceptance criteria

- Given a signed-in user, when they favourite a doctor, then it is saved and the heart shows as filled wherever that doctor appears.
- Given a guest, when they try to favourite a doctor, then the request is refused and the app is told to route them to sign in.
- Given a user favourites the same doctor twice, when their favourites are read, then the doctor appears once.
- Given a user unfavourites a doctor they never favourited, when the request completes, then nothing breaks and the state is 'not favourited'.
- Given a doctor is favourited, when the flow is traced, then the favourite code publishes an event and does not itself create a notification.
- Given the notification consumer throws an error, when a doctor is favourited, then the favourite is still saved and the user's request still succeeds.
- Given the same favourite event is delivered twice, when the consumer has finished, then exactly one notification exists.
- Given user A's favourites, when user B reads theirs, then A's do not appear.

---

## Explicitly out of scope for Sprint 2

- **The doctor profile screen**, clinic tabs, the date strip and the slot picker — Sprint 3, together with availability and booking. CAT-1 models the data they will need; it does not expose the screen.
- Booking, holds, payment, cancellation.
- Writing a review. Reviews are **read** this sprint (ratings on cards, the rating filter); nothing creates one yet — and the Figma has no screen for it.
- Notifications as a feature. CAT-7 publishes the event and a consumer writes the notification; the notifications screen itself comes later.
- The AI assistant, even though its `search doctors` tool will reuse everything built here.
- Arabic search behaviour beyond whatever you document in CAT-3.
