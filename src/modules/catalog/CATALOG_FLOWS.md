# 🩺 DOCURA Catalog Module - Architecture & Flows Guide


---

## 1. 🔍 Search & Filtering Flow
> **[ User Request ]** ➡️ **[ Catalog Query Builder ]** ➡️ **[ Conditions: isVerified = true & Clinic/Pairing isActive = true ]** ➡️ **[ Calculate MIN(consultationFee) ]** ➡️ **[ Render Card ]**

---

## 2. ⭐ Ratings & New Doctors Flow
> **[ New Doctor ]** ➡️ **[ averageRating = 0.0 & totalReviews = 0 ]** 
> * **UI:** Shows **"New"** instead of `0.0 ⭐`.
> * **Sorting:** Uses `NULLS LAST` to push new doctors to the bottom during descending sorts.

---

## 3. 🕒 Booking & Historical Snapshots
> **[ Doctor Changes Profile ]** 🆚 **[ Patient Historical Booking ]**
> * **Solution:** Appointments table saves **Snapshots** (`specialtyName`, `consultationFee`) at booking time, protecting past records from future edits.

---

## 4. 🏥 Permanent Clinic Closure Flow
> **[ Clinic.isActive = false ]** ➡️ 
> * **If other active clinics exist:** Doctor remains visible with active locations and updated fees.
> * **If no other clinics exist:** Doctor temporarily disappears from search results.

---

## 5. ⚡ Outbox Pattern & RabbitMQ (Future Reviews Sync)
> **[ Review Added ]** ➡️ **[ DB Transaction ]** ➡️ **[ Outbox Table ]** ➡️ **[ Background Worker ]** ➡️ **[ RabbitMQ ]** ➡️ **[ Catalog Service ]**