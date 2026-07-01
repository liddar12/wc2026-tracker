# iPhone Home-Screen Widget + Siri Shortcut (free, $0)

The WC26 Tracker is an installable PWA, and iOS **does not let a PWA ship a
native Home-Screen widget or a Siri intent**. This guide gives you both anyway,
for free, using two Apple-approved apps you already can install: **Scriptable**
(for the widget) and the built-in **Shortcuts** app (for Siri).

Everything reads the site's **public** data — no login, no API key, no cost.

- Widget script: [`widget/scriptable-wc26.js`](../widget/scriptable-wc26.js)
- Data it reads: `https://worldcup2026.j5lagenticstrategy.com/data/schedule_full.json`
  and `.../data/actual_results.json`
- What it shows: the **live match with score** if one is in progress, otherwise
  the **next upcoming match** with its kickoff time in your local timezone. Tap
  the widget to open the tracker's schedule.

---

## Part 1 — Home-Screen widget (Scriptable)

### A. Install Scriptable (once)

1. Open the **App Store** on your iPhone.
2. Search for **Scriptable** (by Simon B. Støvring). It is free.
3. Tap **Get** and install it. Open it once so it finishes setting up.

   > Direct link: https://apps.apple.com/us/app/scriptable/id1405459188

### B. Paste in the widget script

1. Open **Safari** and go to
   `https://worldcup2026.j5lagenticstrategy.com/widget/scriptable-wc26.js`
   (this shows the raw script text).
2. Tap and hold anywhere in the text, choose **Select All**, then **Copy**.

   > Alternative: open `widget/scriptable-wc26.js` in the GitHub repo, tap the
   > **Copy raw file** button, and copy from there.

3. Open **Scriptable**. Tap the **+** (plus) button in the top-right to create a
   new script.
4. Tap in the empty editor, then **Paste** the copied script.
5. Tap the **play** (▶) button at the bottom to test it. You should see a preview
   card with either a **LIVE** score or the **NEXT MATCH** and kickoff time. If
   there is no data yet, it says "No upcoming match" — that is expected off-season.
6. Tap the **settings/title** at the top of the editor, rename the script to
   **WC26 Next Match**, then tap **Done** to save.

### C. Add the widget to your Home Screen

1. Go to your iPhone **Home Screen**. Tap and hold on any empty area until the
   apps jiggle.
2. Tap the **+** (plus) in the top-left corner.
3. Search for and select **Scriptable**.
4. Swipe to choose **Small** or **Medium** size, then tap **Add Widget**.
5. Tap the new (blank) Scriptable widget once while still in jiggle mode.
6. In **Script**, choose **WC26 Next Match**.
7. In **When Interacting**, leave it as **Run Script** (tapping opens the tracker).
8. Tap outside the popup, then tap **Done** (top-right). The widget now shows the
   next/live World Cup match and refreshes on its own.

**What you should see when it works:** a dark card titled "WORLD CUP 2026" with a
green **NEXT MATCH** label + two team names + a local kickoff time, or a red
**● LIVE** label + the current score during a match.

---

## Part 2 — Siri Shortcut ("Hey Siri, next World Cup match")

This opens the tracker's schedule page from your voice — no widget needed.

1. Open the built-in **Shortcuts** app (comes with iOS; reinstall from the App
   Store if you deleted it).
2. Tap the **+** (plus) in the top-right to create a new shortcut.
3. Tap **Add Action**. Search for **Open URLs** and select it.
4. Tap the **URL** field in the action and type exactly:

   ```
   https://worldcup2026.j5lagenticstrategy.com/#/schedule
   ```

5. Tap the shortcut's **name** at the top (or the ⓘ / settings icon), and rename
   it to **Next World Cup match**. Siri uses the shortcut name as the phrase.
6. Tap **Done** to save.
7. Test it: say **"Hey Siri, next World Cup match."** Siri opens the tracker's
   schedule, where the next fixtures are listed at the top.

   > To change the trigger phrase, open the shortcut's settings, tap
   > **Add to Siri** (if shown), and record a custom phrase.

**What you should see when it works:** saying the phrase launches Safari (or the
installed PWA) directly on the schedule view.

---

## Notes / troubleshooting

- **"No upcoming match" or blank:** the tournament may be between rounds or
  finished. The script fails safe — a network hiccup shows the empty state, never
  an error dialog.
- **Widget looks stale:** iOS decides widget refresh cadence to save battery;
  it typically updates several times an hour. Tap the widget to open the live
  tracker for real-time scores.
- **Privacy/cost:** the script only performs anonymous GET requests to the two
  public JSON files above. No account, no tracking, no paid API.
- **Updating the script:** when the widget script changes, re-copy the raw file
  (Part 1, step B) and paste over the old script body in Scriptable.
