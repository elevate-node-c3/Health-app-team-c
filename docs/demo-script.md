# Demo script (ENG-7 go-live journey)

Seed: `npm run seed` (catalog, then demo story). Login `demo@docura.eg` /
`Demo1234!`. All seed dates are relative in UTC; the app displays
Africa/Cairo. No manual SQL at any step.

1. **Guest search.** As guest (`x-device-id: demo-device-1`), search
   `dentist`. Expect `200` + `success:true` with Dr. Ahmed Hassan in results.
2. **Filter.** Governorate `Cairo` + `maxPrice 1000`. Expect `200`; doctors
   charging above 1000 remain (`1000` = 1000-and-above).
3. **Profile.** Open Dr. Ahmed Hassan at Cairo Care Clinic. Expect `200` with
   fee `300`, Sun/Tue/Thu schedule, availability strip.
4. **Hold.** As demo patient, hold a free future slot. Expect `201`
   `booking.hold_created` with `holdId`, `frozenFee "300"`, `expiresAt` ~10 min.
5. **Signup/verify land-back.** Register new user → `201` + OTP mail event;
   verify → `200` with tokens; pending hold from step 4 still payable.
6. **Pay.** Pay the hold. Expect `200` + `DONE`; double-submit with the same
   hold returns the stored success without a second charge.
7. **Confirmation.** Inbox shows booking confirmation; reminder is scheduled
   (`APPOINTMENT_BOOKED` consumers). Upcoming tab lists the visit.
8. **Cancel ≥24h.** Cancel the upcoming visit. Expect `200` outcome `FREE`,
   `refundStatus PENDING`, slot bookable again, `APPOINTMENT_CANCELLED` in
   outbox.
9. **Rebook.** Hold the freed slot again. Expect `201`; expired holds return
   `400 Hold expired`.
10. **Clock completion.** After the visit time passes, the cron marks it
    COMPLETED (or NO_SHOW past grace). Expect status change + event, no human
    action.
11. **Prescription.** Completed visit shows Download Prescription enabled;
    download-link → `200` URL, `GET download?token=` streams the PDF bytes.
    Shared link without login → `401`; tampered/expired token → `403`; another
    user's id → `404`. Completed visits without a file show the button
    disabled, not an error.
12. **AI question.** Ask about tooth pain. Expect `200` answer + specialty
    suggestion; guest devices cap at 10/day, users at 50/day (`429` after).
13. **Structured search.** Filter by specialty + sort; analytics events persist
    without touching booking code.
