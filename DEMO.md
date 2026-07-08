# BELTrak Demo Script (15 minutes)

## Setup
- [ ] Open app in browser, login
- [ ] Navigate to Simulator → click "Reset to seed"

## 1. Flag suspect bag (simulates BHS)
- [ ] Simulator → "Flag Suspect Bag"
- [ ] Switch to Tagging Station → bag appears in queue

## 2. Encode RFID tag
- [ ] Select bag → "Print & Encode Tag" → wait for verify
- [ ] If fail → "Re-encode" (shows verify-after-write safety)
- [ ] Bag moves to "Recently Tagged" with EPC

## 3. Track through terminal (simulates RFID readers)
- [ ] Simulator → select the tagged bag
- [ ] Click "Journey A" → watch bag move zone by zone (2s each)
- [ ] Final stop: alarm fires at exit gate → red toast

## 4. Officer response
- [ ] Alarms page → new alarm (ACTIVE) → click Acknowledge
- [ ] Dashboard KPIs update live

## 5. Recheck & resolve
- [ ] Recheck Station → bag details + movement timeline visible
- [ ] Click "Cleared" → green toast → bag resolved

## 6. Suppression proof
- [ ] Simulator → same bag → click Exit Gate button
- [ ] Toast: "suppressed" — no second alarm (bag already cleared)

## 7. Engineering depth (optional)
- [ ] "Burst 15 reads" → shows dedup (14 merged)
- [ ] "Foreign EPC read" → shows discard (unregistered tag ignored)
- [ ] Toggle reader offline → /readers page reflects change

## 8. Reset
- [ ] "Reset to seed" → clean state for next demo