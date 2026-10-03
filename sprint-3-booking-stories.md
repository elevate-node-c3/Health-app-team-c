# Sprint 3 — Booking, Payment and Appointment History

**Project:** DOCURA — Doctor Appointment Booking Platform (Bootcamp Project 2)
**Requirements:** [`requirements.md`](./requirements.md)
**Previous sprints:** [`sprint-1-auth-stories.md`](./sprint-1-auth-stories.md) · [`sprint-2-catalog-stories.md`](./sprint-2-catalog-stories.md)
**Design:** [Figma — Healthy App](https://www.figma.com/design/KyofGEsVa9H2FrxIjQnGKV/Healthy-App?node-id=1171-4322)
**Jira import file:** [`sprint-3-booking-stories.csv`](./sprint-3-booking-stories.csv)

---

## How to read these stories

Same contract as before: **a user flow across real screens**, then the rules, the events, the edge cases, and the acceptance criteria you are graded on. Still no endpoint paths, table names or field lists — deriving them is the assignment.

**What is different about this sprint.** Sprint 1 was writes. Sprint 2 was reads. Sprint 3 is **money and collisions**, and it is graded harder for a reason:

- A bug here charges a real person twice, or sells one appointment to two patients.
- Several acceptance criteria can only be satisfied by a **concurrent test** — two requests at the same instant — not by reading the code and reasoning that it looks fine.
- Two stories (BOOK-2 and BOOK-4) contain the single hardest problem in the project: a slow call to somebody else's computer, in the middle of a database operation, that costs money and can fail halfway.
- BOOK-8 is the other half of event-driven architecture: work that happens because **time passed**, not because a user asked.

If you find yourself writing *check whether the slot is free, then save the appointment* as two separate statements, stop and re-read BOOK-2.

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

**8 stories · 47 points**

| # | Story | Points |
|---|---|---|
| BOOK-1 | Doctor profile and real availability — clinics, days and time slots | 8 |
| BOOK-2 | Holding a slot while the user pays — the one story that decides if two people can book the same time | 5 |
| BOOK-3 | Payment methods — saving a card without ever holding a card number | 5 |
| BOOK-4 | Pay and confirm — the money path, and what happens when it goes wrong | 8 |
| BOOK-5 | My Bookings — history, status, and the prescription | 5 |
| BOOK-6 | Cancelling — the 24-hour rule, the warning, and the refund | 8 |
| BOOK-7 | Rescheduling — moving an appointment without opening a loophole | 3 |
| BOOK-8 | The work nobody triggers — completing, reminding, releasing and reconciling | 5 |

> **This is the largest sprint in the project.** 47 points is more than the previous two. If capacity is tight, the line to cut at is after BOOK-5: availability, holds, cards, payment and history together make a product a patient can actually use. BOOK-6, BOOK-7 and BOOK-8 then become Sprint 3b — but **do not ship BOOK-4 without BOOK-8's reconciliation**, or a failed charge will sit unnoticed.

### Suggested order

```
BOOK-1  Profile + availability   ── the times have to exist before anything can take one
   │
   └─▶ BOOK-2  Holding a slot    ◀── the concurrency guarantee lives here. Do it properly.
          │
          ├─▶ BOOK-3  Saved cards
          │      └─▶ BOOK-4  Pay and confirm   ◀── the money path
          │             ├─▶ BOOK-5  My Bookings
          │             ├─▶ BOOK-6  Cancel + refund
          │             │      └─▶ BOOK-7  Reschedule (closes BOOK-6's loophole)
          │             └─▶ BOOK-8  Scheduled work (completion, reminders, reconciliation)
```

**Start BOOK-2 on day one**, even though it is only 5 points. Every later story either depends on the guarantee it makes or is corrupted by its absence, and it is the story most likely to send you back to your data model.

### What carries over

| Earlier story | Used here by |
|---|---|
| AUTH-5 sessions and access levels | BOOK-2 — only a signed-in, phone-verified user may hold a slot |
| AUTH-2 phone verification | BOOK-2 — the social-login user who never added a phone is stopped here (BR-07) |
| CAT-1 fee on the doctor-clinic pairing | BOOK-1 clinic tabs · BOOK-2 the frozen price · BOOK-3 the total |
| CAT-5 'available today/tomorrow' | BOOK-1 — the same availability question, now authoritative |
| CAT-7 favourites as the event example | BOOK-4, BOOK-6 — the same separation, now with money attached |

### Definition of Done (every story)

- Every rule is enforced **on the server**; the app is never trusted with a price, a status or an allowed action.
- Every acceptance criterion has a test, including the negative ones and, where stated, a **concurrent** one.
- Every edge case listed has a deliberate, defined behaviour.
- Events are published and their consumers live outside the code that publishes them; a failing consumer never undoes the business change.
- Every consumer and every scheduled job is **safe to run twice**.
- No card number, CCV or payment secret exists in any table, log or error response.
- Money is never represented in a way that can lose a piaster to rounding.
- Errors use your shared envelope and documented codes — the app has to tell 'slot gone' apart from 'card declined'.

---

## BOOK-0 — Epic: BOOKING — Appointments, Payment and History

Everything from choosing a time to living with the consequences: real availability, holding
a slot, paying for it, the confirmation, the booking history, cancelling under the 24-hour
rule, rescheduling, and the scheduled work that completes appointments and sends reminders.

Source of truth: the Figma Doctor Profile, Payment Methods, Add New Card, Done, Failed and
My Bookings screens with their cancel dialogs and toasts, plus sections 4 (Modules 3, 4, 5),
5.2, 5.3, 5.4 and 6.2 of the project requirements document.

Depends on Sprint 1 (sessions, verified users) and Sprint 2 (the catalogue, doctors, clinics
and the per-clinic fee).

This is the heaviest and most important sprint in the project. It is the one that handles
money and the one where two users can collide.

**Epic acceptance criteria**

- A patient can see genuinely free times, hold one, pay for it and receive an immediate, authoritative confirmation.
- Two users cannot book the same slot, and a concurrent test proves it.
- No card number or CCV exists anywhere in the system.
- A double tap, a retry or a crash never produces two charges or a charge without an appointment.
- Cancelling applies the 24-hour rule decided by the server at the moment of cancellation, frees the slot, and refunds when it should.
- Rescheduling cannot be used to escape the no-refund rule.
- Appointments complete, reminders fire, holds are released and charges are reconciled without anybody triggering them.
- Every consumer and every scheduled job is safe to run twice.

---

## BOOK-1 — Doctor profile and real availability — clinics, days and time slots

**8 points · Priority Highest · `booking,availability,sprint-3`**

### User story
As a patient who has found a doctor
I want to see which clinic, which day and which exact times are genuinely free
So that I can pick one and trust that it is still there when I pay

### User flow (see Figma)
Search results or Home -> tap a doctor -> Doctor Profile.

From the Figma, top to bottom:
  photo, name, specialty, university · +400 Patients / 4Y Experience / 4.4 Rate
  CLINIC TABS   (Maadi Clinic · Nasr City Clinic · Maadi Armed Forces...)
  Select Date   month header with < May > arrows and a horizontal day strip
  Select Time   period tabs  Morning | Afternoon | Night
                then slot chips: 09:00 am, 09:30 am, 10:00 am...
  collapsible   About · Academic and Professional Experience · Subspecialties ·
                Doctor's Questions and Answers · Ratings & Reviews
  sticky button "Appointment Now"

Look closely at the slot chips in the design: some are greyed out. Those are already
booked, and they are still VISIBLE. That is deliberate — showing a full morning is what
convinces a user the schedule is real. Hiding them would look like an empty calendar.

Switching the clinic tab changes the schedule AND the price.

### Rules and validations
- Schedule belongs to the pairing: Working hours belong to the doctor at a specific clinic (BR-10, CAT-1). Switching the clinic tab reloads the days, the times and the fee.
- Recurring hours become individual times: A doctor works 'Saturdays, 9am to 1pm, 30 minutes per patient'. The user picks '09:30 on 12 May'. Turning the first into the second is the core of this story — decide whether those individual times are stored ahead of time or worked out on request, and defend the choice.
- Three periods: Times are grouped Morning, Afternoon and Night. Decide the boundaries and apply them consistently.
- Taken times stay visible: A booked time is returned and marked as taken, not omitted (BR-11). The app shows it greyed out.
- Never offer the past: A time earlier than now is never offered as free, including earlier today. 'Now' is Africa/Cairo.
- How far ahead: Decide how far into the future a patient may book and apply it everywhere, including the month arrows.
- A snapshot, not a promise: This response says what was free when it was built. It is NOT a reservation — nothing here stops someone else taking the same time one second later. The guarantee happens in BOOK-2 and BOOK-4.
- The price comes with it: The fee shown is the fee for this doctor at this clinic, and it is the number BOOK-2 will freeze.
- Only bookable pairings: An inactive clinic pairing or an unverified doctor exposes no availability at all.

### Domain events to publish
- A doctor profile was viewed (analytics).

### Edge cases to handle
- A user opens the profile and leaves the app open for an hour — are those times still real when they come back?
- The clinic changes its working hours for a day that already has bookings.
- A doctor takes leave for a week.
- Daylight saving or a timezone change between the server and Cairo.
- A doctor's slot length changes from 30 to 20 minutes while future bookings exist.

### Acceptance criteria

- Given a doctor who works at three clinics, when the user switches clinic tab, then the days, times and fee all change to that clinic's.
- Given a day with working hours, when availability is requested, then the times are returned grouped into Morning, Afternoon and Night.
- Given a time that is already booked, when availability is requested, then it is returned and marked as taken rather than omitted.
- Given a request for today at 2pm Cairo time, when availability is returned, then no morning time appears as free.
- Given a date beyond the booking window, when it is requested, then it is refused or returns nothing, consistently with what the month arrows allow.
- Given a doctor with no working hours on a chosen day, when availability is requested, then the response is a well-formed empty day, not an error.
- Given an inactive doctor-clinic pairing, when availability is requested, then nothing is returned.
- Given availability was returned at 10:00 and that time is booked by someone else at 10:00:30, when the first user requests it again, then it now shows as taken.
- Given a month of availability is requested for a busy doctor, when the query is traced, then the number of database round trips does not grow with the number of days or slots returned.

---

## BOOK-2 — Holding a slot while the user pays — the one story that decides if two people can book the same time

**5 points · Priority Highest · `booking,concurrency,sprint-3`**

### User story
As a patient who just tapped "Appointment Now"
I want the time I chose to be mine while I enter my card details
So that I do not lose it halfway through paying

### User flow (see Figma)
Doctor Profile -> pick a clinic, a date and a time -> "Appointment Now"
-> the Payment Method screen opens (BOOK-3 / BOOK-4).

Between those two moments the slot must become the user's, temporarily. Nothing in the
Figma shows this step — it has no screen. It exists because of what the design implies:
the user is typing a card number while that time sits unbooked.

This is the most important story in the project. Get it wrong and two patients arrive at
the same clinic for the same minute.

### Rules and validations
- A hold is a real thing: Taking a slot out of circulation while someone pays is a state the system holds, not a comment in the code. A held slot is offered to nobody else.
- Ten minutes, once extended: A hold lasts 10 minutes, extended once by 5 minutes when the user is sent to the bank's 3-D Secure page (BR-18).
- Abandoned holds come back: A user who closes the app must not lock the slot forever. An expired hold returns the slot to the pool automatically — without a human and without the user doing anything.
- The price is frozen here: The fee is captured when the hold is created and that is the amount charged, even if the doctor's fee changes in the meantime (BR-17).
- Exactly one winner: When two users ask to hold the same slot at the same instant, exactly one succeeds and the other is refused with a clear, recoverable answer. Checking 'is it free?' and then writing 'it is mine' as two separate steps is the bug this story exists to teach — the guarantee has to be somewhere that two simultaneous requests cannot both pass through.
- Only the holder can use it: A hold belongs to one user's attempt. Another user's payment cannot consume it, and neither can the same user's second attempt.
- Holds are not bookings: A held slot is not an appointment. It appears in nobody's history and sends no confirmation.
- Signed in and verified: Holding requires a signed-in user with a verified phone (BR-07, AUTH-5). A guest is refused and routed to sign in — and the slot they picked should still be waiting for them when they come back if it has not been taken.

### Domain events to publish
- A slot was held.
- A hold expired (so the slot is released and anything watching can react).

### Edge cases to handle
- The user picks a slot, spends four minutes on the card form, and someone else took the slot before the hold existed.
- The same user opens two devices and holds two different slots with the same doctor.
- A hold exists when the clinic deletes that working day.
- The process that releases expired holds is down for an hour — what does the user see, and what happens when it comes back?
- A user holds a slot, abandons it, and immediately tries to hold the same slot again.

### Acceptance criteria

- Given a free slot, when a verified user holds it, then the response carries the hold, its expiry and the frozen price.
- Given a held slot, when another user requests availability, then that slot is not offered as free.
- Given two users request the same slot at the same instant, when both requests complete, then exactly one holds it and the other receives a clear 'slot unavailable' answer — proven by a concurrent test, not by reasoning.
- Given a hold, when 10 minutes pass with no payment, then the slot becomes free again automatically.
- Given a hold whose user is sent to 3-D Secure, when the extension is applied, then it lasts 5 minutes longer, and only once.
- Given a doctor's fee changes after a hold was created, when the user pays, then they are charged the frozen price.
- Given a hold belonging to user A, when user B tries to pay against it, then it is refused.
- Given a guest, when they try to hold a slot, then it is refused and the app is told to route them to sign in.
- Given a signed-in user whose phone is not verified, when they try to hold a slot, then it is refused for that reason.
- Given a held slot, when the holder's history is read, then nothing appears — a hold is not an appointment.

---

## BOOK-3 — Payment methods — saving a card without ever holding a card number

**5 points · Priority High · `payment,cards,security,sprint-3`**

### User story
As a patient who books more than once
I want my card saved so I do not retype it every time
So that paying takes one tap

### User flow (see Figma)
Payment Method screen (from the Figma):
  a radio list of saved cards — "Visa  **** **** **23" — each with Delete and Edit
  "+ Add New Card"
  a price summary: "Booking Price : EGP 200.00"  and  "Total : EGP 200.00"
  Confirm · Back

Add New Card screen:
  a live card preview, then Cardholder's Name, Card Number, CCV, Expiry Date (MM/YY),
  a "Save Card" checkbox, and the "Add New Card" button.

Note the Save Card checkbox. It is not decoration — an unticked box means use this card
once and forget it.

### Rules and validations
- Never hold the dangerous parts: The platform never stores a card number or a CCV (BR-13). What you may keep is the brand, the last four digits, the holder's name, the expiry and whatever reference the payment provider gives you. If your database can hold a full card number, this story fails regardless of the tests.
- Save only when asked: A card is stored only when Save Card is ticked. Otherwise it is used for this payment and never persists.
- Cards are owned: A user only ever sees, edits, deletes or pays with their own cards. Another user's card is not found.
- Deleting is not forgetting the past: Deleting a card must not damage the record of payments already made with it. A past appointment still shows what was paid.
- Editing: Only the safe parts can be edited — the holder's name and the expiry. Editing never reveals or re-collects the number.
- One selected card: Exactly one card is used for a payment. Decide how a default is chosen when the user has several.
- Expired cards: An expired card is not offered as payable. Decide whether it is hidden or shown as unusable, and be consistent.
- Total is computed here, by the server: Booking Price and Total come from the frozen hold price (BOOK-2), not from the app. Today they are equal (BR-12) — model the summary so a fee or a discount could be added without redesigning it.

### Domain events to publish
- A payment method was added.
- A payment method was removed.

### Edge cases to handle
- The user deletes the card that is currently selected for the payment they are in the middle of.
- A card expires between being saved and being used.
- The payment provider loses or rotates its reference for a saved card.
- The user adds the same card twice.
- The user has no saved cards at all — what does the payment screen do?

### Acceptance criteria

- Given a user adds a card with Save Card ticked, when their payment methods are listed, then it appears showing brand, last four digits and expiry — and nothing else identifying the card.
- Given a user adds a card with Save Card unticked, when the payment completes, then no stored card exists afterwards.
- Given the whole database is inspected, when card storage is audited, then no full card number and no CCV exists anywhere, including in logs and error payloads.
- Given user A's saved card, when user B tries to read, edit, delete or pay with it, then it is not found.
- Given a card used for a past appointment is deleted, when that appointment is read, then its payment record is still intact.
- Given a user edits a card, when the edit completes, then only the holder name and expiry changed and the card number was never re-collected.
- Given a user with several cards, when the payment screen is requested, then exactly one is selected by the documented default rule.
- Given an expired card, when the payment screen is requested, then it is not offered as payable.
- Given a hold with a frozen price, when the payment summary is built, then Booking Price and Total come from that frozen price and not from anything the app sent.

---

## BOOK-4 — Pay and confirm — the money path, and what happens when it goes wrong

**8 points · Priority Highest · `booking,payment,money,sprint-3`**

### User story
As a patient with a slot held and a card chosen
I want to pay and be told immediately that my appointment is real
So that I never have to phone the clinic to check

### User flow (see Figma)
Payment Method -> Confirm -> one of two screens:

DONE:   "Your appointment has been booked successfully
         On Tuesday, July 30 at 3:00 PM with Dr. Ahmed Mohamed.
         We will reminder you, Please arrive 15 minutes before the appointment."

FAILED: "Payment Failed, We couldn't process your payment.
         Please check your card details"

Plus, away from the screen: a confirmation notification, an SMS and an email
(the Notifications screen shows "Booking Confirmed - Your appointment with
Dr. Ahmed Mohamed at CityCare Clinic on 15 October 2025 - 3:00 PM has been confirmed").

This is the whole product thesis in one request. The user interviews said people do not
trust apps because the clinic calls back to confirm. Your response IS the confirmation.

### Rules and validations
- The hold must still be valid: Payment is only possible against a live hold owned by this user (BOOK-2). An expired hold is refused with a reason the app can act on, and the user goes back to choosing a time.
- The amount is the frozen amount: Charge the price frozen on the hold. Never an amount that arrived from the app.
- Charging is not a database operation: The call to the payment provider is slow and happens on someone else's computer. Holding a database transaction open across it is a mistake this story is designed to expose — decide what is saved before the charge, what after, and what state the system is in between.
- One tap, one charge: A double tap, an app retry or a flaky network must never produce two charges or two appointments. The safe-to-retry mechanism belongs on the request itself, not in a comment.
- Failure leaves nothing behind: A declined or failed payment creates no appointment and releases the slot for someone else (BR-16).
- Charged but not booked: If the charge succeeds and saving the appointment then fails, the user has paid for nothing. Decide how this is detected and repaired without a human noticing first — and be honest that it will happen.
- The provider has the last word: Payment providers also report results out-of-band, after the fact. Their word is authoritative, those messages can arrive twice or out of order, and they must be verified as genuinely coming from the provider.
- Confirmation is instant and in-app: The successful response IS the confirmation (BR-14). The SMS, email and push are additional and must not delay it.
- Fan out through events: The booking publishes an event. The SMS sender, the email sender, the push sender and the reminder scheduler are separate consumers. If the SMS provider is down, the appointment is still booked and the user still sees success.
- Arrive early: The confirmation tells the patient to arrive 15 minutes before the appointment (BR-15).

### Domain events to publish
- An appointment was booked (consumed by the SMS, email, push and reminder scheduler).
- A payment succeeded.
- A payment failed.

### Edge cases to handle
- Payment succeeds and the server crashes one line before the appointment is saved.
- The provider's result message arrives before the synchronous response has finished.
- The doctor is deactivated while the user is on the payment screen.
- The user's session expires mid-payment.
- The provider is completely unreachable — what does the user see, and is the slot still theirs?
- A user pays for two different slots with the same doctor at overlapping times.

### Acceptance criteria

- Given a live hold and a valid card, when the user confirms, then they are charged the frozen amount, an appointment exists in Upcoming, the slot is taken, and the response is the confirmation itself.
- Given an expired hold, when the user confirms, then the request is refused with a reason the app can act on and no charge is made.
- Given the user double-taps Confirm, when both requests complete, then exactly one charge and one appointment exist.
- Given the app retries the same confirm request after a timeout, when it completes, then the original result is returned and no second charge is made.
- Given the payment provider declines the card, when the response returns, then no appointment exists and the slot is free for someone else.
- Given the charge succeeds but saving the appointment fails, when the system next reconciles, then the discrepancy is detected and resolved without a person finding it first.
- Given the provider sends the same result message twice, when both are processed, then the outcome is identical to processing it once.
- Given a result message that cannot be proven to come from the provider, when it arrives, then it is rejected.
- Given a successful booking, when the flow is traced, then the booking publishes an event and the SMS, email, push and reminder work is done by separate consumers.
- Given the SMS provider is down, when a user books, then the booking still succeeds and the user still sees the confirmation screen.
- Given a successful booking, when the confirmation is read, then it names the doctor, the date and the time and tells the patient to arrive 15 minutes early.
- Given the slot was taken by someone else in the instant before the charge, when the user confirms, then they are not charged and are told the slot is gone.

---

## BOOK-5 — My Bookings — history, status, and the prescription

**5 points · Priority High · `booking,history,sprint-3`**

### User story
As a patient
I want one place showing what is coming, what I attended and what I cancelled
So that I can act on each one without hunting

### User flow (see Figma)
Bottom tab "Booking" -> My Bookings.

Tabs: All · Upcoming · Completed · Cancelled.

Each card shows the date and time, the doctor's photo, name, specialty, the clinic and
area, and a coloured status badge. The BUTTONS ON THE CARD CHANGE WITH THE STATUS:

  Upcoming   amber badge   -> Cancel · Reschedule
  Completed  green badge   -> Download Prescription
  Cancelled  red badge     -> Re-Book

Look carefully at the Completed tab in the Figma: one card's Download Prescription button
is GREY. That appointment has no prescription yet. The button is disabled, not hidden.

Each tab has its own empty state.

### Rules and validations
- Actions come from status: The app does not decide which buttons to show — the status does (BR-29). The server returns the status and the app renders the matching actions. Never return an action the user is not allowed to take.
- Own bookings only: A user sees only their own appointments. Another user's appointment is not found.
- Newest first, paged: History grows forever. It is ordered and paged, and paging does not repeat or lose appointments.
- Each tab has an empty state: A tab with nothing in it returns a well-formed empty result, not an error.
- Prescriptions exist only sometimes: A prescription can be downloaded only for a completed appointment that actually has one (BR-30). When there is none, the response must let the app show the button disabled — so 'no prescription' is a normal answer, not a failure.
- Prescription files are private: The file is reachable only by the patient it belongs to, through a link that expires. A link forwarded to someone else must not open.
- Re-Book starts fresh: Re-booking a cancelled appointment begins a new booking with the same doctor and clinic pre-selected (BR-31). It never revives the old appointment, and the old one stays cancelled in the history.
- The card is self-contained: Each card carries everything the design shows — doctor, specialty, clinic, area, date, time, status — without the app making a request per card.

### Domain events to publish
- A prescription was issued (so the patient can be told it is ready).

### Edge cases to handle
- An appointment's time passes while the user is looking at the Upcoming tab.
- A doctor or clinic is deleted after an appointment with them was completed — the history must still read correctly.
- A prescription file is missing from storage although the record says it exists.
- A user re-books a cancelled appointment with a doctor who has since deactivated.

### Acceptance criteria

- Given a user with appointments in every state, when each tab is requested, then it contains exactly the matching appointments and All contains them together.
- Given an upcoming appointment, when it is returned, then the allowed actions are cancel and reschedule; given a completed one, prescription; given a cancelled one, re-book.
- Given user A's appointment, when user B requests it, then it is not found.
- Given a completed appointment with no prescription, when it is returned, then the response says so clearly and the app can disable the button rather than erroring.
- Given a completed appointment with a prescription, when the user requests the file, then they receive a link that works for them and expires.
- Given that link is forwarded to another user, when they open it, then it does not work.
- Given a tab with no appointments, when it is requested, then a well-formed empty result is returned.
- Given a user with many appointments, when every page is walked, then none repeats and none is missing.
- Given a page of appointments, when the query is traced, then the number of database round trips does not grow with the number of cards.
- Given a cancelled appointment is re-booked, when the new booking is made, then it is a new appointment and the old one is still cancelled.

---

## BOOK-6 — Cancelling — the 24-hour rule, the warning, and the refund

**8 points · Priority Highest · `booking,cancellation,refund,sprint-3`**

### User story
As a patient whose plans changed
I want to cancel and know exactly what it costs me before I confirm
So that I am never surprised by a charge

### User flow (see Figma)
My Bookings -> Upcoming -> Cancel -> a confirmation dialog whose WORDING DEPENDS ON TIME:

24 hours or more away:
  "Cancel Appointment - Are you sure you want to cancel your appointment with Dr. Ali on
   27 sep 2025 at 10:30 am?"    "No fees will be charged!"
  -> toast: "cancelled Successfully! No fees will be charged."

Less than 24 hours away:
  "Cancel Appointment - Are you sure you want to cancel your appointment with Dr. Basma on
   22 sep 2025 at 11:30 am?"    "No refund available if you cancel now!"
  -> toast: "Appointment cancelled! No refund available as cancellation was made less
             than 24 hours before the scheduled time."

Two dialogs, two toasts, one rule. The user learns the financial consequence BEFORE they
confirm, never after (BR-22).

### Rules and validations
- The rule: 24 hours or more before the appointment: cancelled free, money refunded (BR-20). Less than 24 hours: cancelled, no refund (BR-21). The boundary itself counts as free (D1).
- The app asks twice, in effect: The app needs to know which dialog to show before the user confirms, and the system needs to decide what actually happens when they do. Both answers come from the server.
- The second answer wins: A dialog opened at 24h05m and confirmed at 23h58m promised 'no fees' but is now inside the window. The decision is recomputed at the moment of cancellation and that is what applies (BR-24) — the app renders the outcome it is given, not the one it predicted. Decide what you tell the user and make it fair.
- Always frees the slot: Both outcomes release the slot so another patient can book it (BR-23).
- Refund now, money later: A free cancellation issues the refund immediately, but the money takes 5-10 business days to arrive. Until it does the appointment shows a refund-pending state (BR-26) — so the refund has a life of its own, separate from the appointment's.
- Only cancellable things can be cancelled: An appointment that is already cancelled, already completed, or already started cannot be cancelled. Each refusal says why.
- Cancel once: Two cancel requests for the same appointment, from two devices or a retry, produce one cancellation and at most one refund.
- Reminders stop: Cancelling cancels the reminder (BR-32). Nobody is reminded of an appointment they cancelled — and this happens through the event, not inside the cancel code.
- Own appointments only: A user can only cancel their own appointment.

### Domain events to publish
- An appointment was cancelled (consumed by the reminder canceller, the slot releaser and the notifier).
- A refund was issued.
- A refund was settled.

### Edge cases to handle
- The user cancels from two devices at the same second.
- The user cancels an appointment that the clock marked completed one minute ago.
- The refund is rejected by the payment provider.
- The user cancels while the provider's original charge is still being confirmed.
- A user cancels every appointment they ever make — is there a pattern worth recording?

### Acceptance criteria

- Given an appointment 30 hours away, when the user asks what cancelling costs, then the answer is free and the app shows the 'No fees will be charged!' dialog.
- Given an appointment 6 hours away, when the user asks, then the answer is no-refund and the app shows the 'No refund available if you cancel now!' dialog.
- Given an appointment exactly 24 hours away to the second, when the user cancels, then it is free — proven by a test at the exact boundary.
- Given the user was told 'free' at 24h05m and confirms at 23h58m, when the cancellation is processed, then the no-refund rule applies, the response says so, and the app shows that outcome rather than the one it predicted.
- Given a free cancellation, when it completes, then a refund is issued, the appointment shows refund-pending, and the slot is free again.
- Given a no-refund cancellation, when it completes, then no refund is issued and the slot is still freed.
- Given a refund is later settled by the provider, when the appointment is read, then it no longer shows refund-pending.
- Given two cancel requests arrive at the same moment for the same appointment, when both complete, then there is one cancellation and at most one refund.
- Given an already-cancelled, already-completed or already-started appointment, when cancelling is attempted, then it is refused with a reason naming the case.
- Given user A's appointment, when user B cancels it, then it is not found.
- Given an appointment with a scheduled reminder, when it is cancelled, then the reminder does not fire — and the cancel code contains no reference to reminders.

---

## BOOK-7 — Rescheduling — moving an appointment without opening a loophole

**3 points · Priority High · `booking,reschedule,sprint-3`**

### User story
As a patient who can no longer make the time
I want to move my appointment instead of cancelling and paying again
So that I keep my booking and my money

### User flow (see Figma)
My Bookings -> Upcoming -> Reschedule -> pick a new time for the same doctor and clinic
(the same picker as BOOK-1) -> confirm -> the appointment now shows the new time.

The Figma has the button but no destination screen. You are defining the behaviour, and
the rule below is the reason this small story is not optional.

### Rules and validations
- The same 24-hour rule: A free reschedule is allowed only when the appointment is 24 hours or more away (BR-25). Inside 24 hours it is refused.
- Why it is refused: Without this rule, a patient 2 hours from their appointment could reschedule to next week and then cancel for free — collecting a refund the no-refund rule was written to prevent. Closing that loophole is the entire point of this story.
- Once: An appointment may be rescheduled once. A second attempt is refused.
- Same doctor, same clinic: Rescheduling moves the time. Changing doctor or clinic means cancelling and booking again.
- The swap is all-or-nothing: The new time must be taken and the old one released together. The system must never end up holding both, or neither.
- The new time must be genuinely free: The new slot is subject to the same competition as any booking (BOOK-2). If someone takes it first, the reschedule fails and the ORIGINAL appointment must survive untouched.
- No new charge: The patient already paid. Rescheduling does not charge again and does not refund.
- Reminders follow: The reminder moves with the appointment — the old one does not fire, a new one is scheduled — and this happens through the event, not inside the reschedule code.

### Domain events to publish
- An appointment was rescheduled (consumed by the reminder rescheduler and the notifier).

### Edge cases to handle
- A user reschedules to a time 2 hours away, then immediately tries to cancel for free — what happens?
- Two reschedule requests for the same appointment arrive at once.
- The doctor's schedule changes between opening the picker and confirming.
- The new time is in a different clinic's timezone assumption — is the 24-hour check still correct?

### Acceptance criteria

- Given an appointment 30 hours away and a free new time, when the user reschedules, then the appointment shows the new time, the old slot is free and the new one is taken.
- Given an appointment 6 hours away, when the user tries to reschedule, then it is refused with the 24-hour reason.
- Given an already-rescheduled appointment, when the user tries again, then it is refused.
- Given a reschedule, when it completes, then no additional charge and no refund occurred.
- Given the new time is taken by someone else in the same instant, when the reschedule fails, then the original appointment is intact and its slot is still held for the patient.
- Given a reschedule, when the reminders are inspected, then the old reminder does not fire and a new one exists for the new time.
- Given a user tries to reschedule onto a different doctor or clinic, when the request arrives, then it is refused.
- Given a cancelled or completed appointment, when rescheduling is attempted, then it is refused.

---

## BOOK-8 — The work nobody triggers — completing, reminding, releasing and reconciling

**5 points · Priority High · `booking,scheduled-work,events,sprint-3`**

### User story
As the platform
I need work that happens on time without a user or a doctor asking for it
So that appointments complete, reminders arrive, abandoned holds come back and no charge is lost

### User flow (see Figma)
No screen. This story is everything the system does while nobody is looking, and it is the
second half of the event-driven goal: Sprint 1 and 2 taught reacting to something that
happened; this teaches work that happens because TIME passed.

What the earlier screens quietly assume exists:
  the Notifications screen shows "Reminder: You have an appointment with Dr. Ali Nasser
  tomorrow at 5.00 PM" — somebody scheduled that.
  the Completed tab fills up on its own — somebody moved those appointments.
  an abandoned hold disappears — somebody released it.

### Rules and validations
- Appointments complete themselves: An upcoming appointment becomes completed once its time has passed (BR-27). There is no doctor app, so the clock decides.
- No-show is not completed: A patient who does not attend is recorded as a no-show: final, no refund, and distinct from a completed visit (BR-28). Decide how it is established, given nobody reports it today, and document what you chose.
- Reminders are scheduled, not polled: A reminder is arranged when the appointment is booked and fires before it (BR-32). It is cancelled when the appointment is cancelled and moved when it is rescheduled.
- Expired holds are released: Abandoned holds return their slots automatically (BOOK-2).
- Charges are reconciled: Something compares what the payment provider thinks happened with what the system recorded, and resolves the differences — including the charge that succeeded while the server was crashing (BOOK-4).
- Refunds are followed to the end: A refund stays pending until the provider says it settled, and something keeps checking (BR-26).
- Everything is safe to repeat: Every piece of this work may run twice — a retry, a restart, two servers. Running it twice must not send two reminders, complete an appointment twice, or refund twice.
- Two servers, one outcome: In production more than one copy of the application is running. Two copies must not both do the same job — decide how they avoid it.
- Failures are visible: Work that fails is retried and, if it keeps failing, ends up somewhere a human will see it. Silently swallowing it is the failure mode this rule exists to prevent.

### Domain events to publish
- An appointment was completed.
- An appointment was marked a no-show.
- A reminder is due.
- A hold expired.

### Edge cases to handle
- The server is down for two hours — do the reminders that were due during that window still go out, or are they now pointless?
- A reminder is due for an appointment cancelled one second earlier.
- The clock jumps, or the server runs in UTC while the appointment was in Cairo.
- Thousands of appointments complete at the same minute.
- The reconciliation finds a charge with no appointment, and the slot has since been booked by somebody else.

### Acceptance criteria

- Given an appointment whose time has passed, when the completion work runs, then it moves to Completed and appears in that tab.
- Given an appointment booked for tomorrow, when the reminder work runs, then the patient receives the reminder before the appointment and not after it.
- Given an appointment is cancelled after its reminder was scheduled, when the reminder time arrives, then nothing is sent.
- Given an appointment is rescheduled, when both reminder times arrive, then only the new one fires.
- Given a hold older than its expiry, when the release work runs, then the slot is free and bookable again.
- Given a charge that succeeded at the provider with no matching appointment, when reconciliation runs, then the discrepancy is surfaced and resolved by the documented rule.
- Given a refund that the provider has settled, when the refund work runs, then the appointment stops showing refund-pending.
- Given every scheduled job is run twice in a row, when the results are compared, then nothing was duplicated — no second reminder, no second refund, no double completion.
- Given two application instances are running, when the same job is due, then the work is performed once.
- Given a job fails repeatedly, when it exhausts its retries, then it is recorded somewhere a person can find it, and the rest of the system keeps working.

---

## Explicitly out of scope for Sprint 3

- **The notifications screen.** BOOK-4, BOOK-6 and BOOK-8 publish events and their consumers send confirmations and reminders; the screen that lists them, with its Newest/Old grouping and 'Mark all as Read', comes later.
- **Writing a review after a completed appointment.** The status now exists to allow it, but the Figma has no screen for it (requirements, Appendix A).
- **Uploading prescriptions.** BOOK-5 serves a prescription when one exists; nothing in this project creates one. Seed them, or add an admin path and say so.
- **The AI assistant**, whose `get my upcoming appointments` tool will read what this sprint writes.
- **Insurance, medical history, home visits, gamification** — claimed by the product team, never designed.
