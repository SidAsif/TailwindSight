# TailwindSight — Features Roadmap

A living document tracking what's built, what's planned, and what will make TailwindSight stand out from every other Tailwind inspector on the market.

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Shipped in v1.0.0 |
| 🔨 | In progress |
| 🎯 | High priority — next to build |
| 💡 | Planned |
| 🌟 | Unique — no competitor has this |

---

## What's Already Shipped (v1.0.0)

### Core Inspection
- ✅ Click any element to open the inspector panel
- ✅ Visual highlight — 2px indigo border overlay on selected element
- ✅ Intelligent panel positioning (stays on-screen near the clicked element)
- ✅ Close button to dismiss the panel

### Class Management
- ✅ Add classes via input field or autocomplete suggestions
- ✅ Remove classes with the × button
- ✅ Changes apply instantly to the DOM (live preview)
- ✅ Full undo / redo stack

### Validation & Autocomplete
- ✅ Real-time autocomplete from a 1,245-class Tailwind dictionary
- ✅ Up to 10 suggestions shown in a styled dropdown
- ✅ Validation for basic classes, responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`), state variants (`hover:`, `focus:`, `dark:`, etc.), opacity modifiers (`text-gray-600/90`), arbitrary values (`text-[#ff0000]`), `!important` modifier, and stacked modifiers (`md:hover:text-4xl`)
- ✅ Red error message for invalid class input

### Class Status Indicators
- ✅ Green dot (●) — class is active and rendering
- ✅ Gray dot (○) — class is inactive or overridden
- ✅ Conflict detection across 17 property groups (fontSize, textColor, bgColor, display, width, height, padding, margin, etc.)

### Utilities
- ✅ One-click copy all classes to clipboard
- ✅ Toast notifications for success/error feedback
- ✅ Inspection mode persisted via `chrome.storage.local`
- ✅ State restored on page reload

### UI / UX
- ✅ Professional dark theme (`#0f1419` base, `#6366f1` indigo accents)
- ✅ Custom scrollbars on class list and suggestions dropdown
- ✅ Smooth transitions (0.15s on highlights, 0.2s on toasts)
- ✅ Scale animation on button press

---

## Quick Wins — v1.1.0 ✅ Shipped

### Escape Key to Close Panel
- ✅ Press `Escape` to dismiss the inspector panel

### Class Count Badge
- ✅ Header shows `ClassList (12)` — updates live as classes are added/removed

### Search / Filter Applied Classes
- ✅ Filter input above the class list — type to narrow down applied classes instantly
- Clears automatically when a new element is selected

### HTML Snippet Export
- ✅ `</>` button in the header copies the full `outerHTML` of the selected element
- Toast confirms: "HTML copied!"

---

## Differentiating Features — v1.2.0

### 🌟 1. "Why Isn't This Class Working?" Debugger

**The biggest unsolved problem in the Tailwind ecosystem. No competitor does this.**

Developers apply a class and it silently does nothing. They spend 10 minutes manually hunting through DevTools.
TailwindSight will diagnose it in one click and explain the issue in plain English.

**How it works:**
1. User clicks the debug icon (🔍) next to any class badge in the panel
2. Extension runs a series of checks:
   - Is the viewport too narrow for the responsive prefix? (`md:` requires ≥768px)
   - Is a conflicting class in the same property group overriding it?
   - Is an inline style on this element or a parent winning the cascade?
   - Is a CSS file rule with higher specificity overriding it?
   - Does `window.getComputedStyle()` confirm the property is being applied?
3. Returns a single-sentence diagnosis

**Example outputs:**
> ⚠️ `md:text-xl` is not active — your viewport is 640px wide, but `md:` activates at 768px. Resize the window or switch to `sm:text-xl`.

> ⚠️ `text-red-500` is being overridden by an inline style (`color: blue`) on this element. Remove the inline style or prepend `!` to force it.

> ⚠️ `font-bold` and `font-normal` are both applied. `font-normal` wins because it appears later in the class list. Remove one of them.

> ✅ `bg-indigo-600` is active and rendering correctly (`background-color: rgb(79, 70, 229)`).

**Implementation notes:**
- Compare `getComputedStyle(el)[property]` against what the class should produce
- Cross-reference conflict groups already built into the extension
- Check `el.style` for inline overrides
- Walk up the DOM for inherited properties

---

### 🌟 2. Inline Class-to-CSS Explainer

**Developers constantly switch tabs to docs to look up what a class does. This ends that.**

Hover any class badge in the panel → tooltip appears showing the exact CSS the class generates.

**Examples:**

| Class | Tooltip |
|-------|---------|
| `p-4` | `padding: 1rem` (16px on all sides) |
| `md:flex-col` | `@media (min-width: 768px) { flex-direction: column }` |
| `text-gray-600/90` | `color: rgb(75 85 99 / 0.9)` |
| `shadow-lg` | `box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` |
| `rounded-full` | `border-radius: 9999px` |
| `truncate` | `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` |

**Implementation notes:**
- Build a `class → CSS string` lookup map from the Tailwind documentation values
- Cover all classes in `tailwind-classes.json` with their generated CSS
- Show tooltip on hover with a 200ms delay (avoids flicker)
- Tooltip positioned above the class badge, arrow pointing down

---

### 🌟 3. Live Breakpoint Ruler

**No competitor integrates a breakpoint indicator into an inspector panel. Standalone breakpoint tools exist, but they don't talk to the inspector.**

A persistent bar at the top of the page while inspection mode is active showing:
- Current viewport width in pixels
- Which breakpoint is currently active (highlighted)
- Visual markers for all Tailwind breakpoint thresholds

```
 512px        640px        768px       1024px      1280px      1536px
  |     xs     |     sm     |     md     |     lg     |    xl    |   2xl
                                  ↑ you are here (md — 834px)
```

**When an element is selected:**
- The class panel highlights which responsive variants are currently firing
- Classes with an inactive prefix (`lg:` when viewport is `md`) are dimmed with a tooltip: *"Activates at 1024px (190px wider)"*

**Implementation notes:**
- Inject a fixed-position bar (height: 28px, `z-index: 2147483647`) at the top of the page
- Listen to `window.resize` and update width + active breakpoint in real time
- Color the active breakpoint segment with indigo, others in gray
- Only visible while inspection mode is active

---

### 🌟 4. Accessibility Checker

**The only Tailwind a11y tool is a VSCode plugin — there is no browser extension equivalent.**

When any element is inspected, run automatic accessibility checks and show a badge:

**Color Contrast (WCAG 2.1)**
- Detect text color class and background color class on the element (or nearest parent with background)
- Calculate contrast ratio
- Show: `AA ✅ (5.2:1)`, `AA ✗ (3.1:1 — needs 4.5:1)`, or `AAA ✅ (7.1:1)`
- Suggest the nearest Tailwind shade that would pass: *"Try `text-gray-900` for AA compliance"*

**Text Size**
- Flag `text-xs` (12px) used on body text as a potential accessibility issue
- Warn when `text-xs` is combined with low-contrast colors (double violation)

**Interactive Elements**
- Warn if a `<button>` or `<a>` lacks `focus:` variant classes
- Flag missing `focus-visible:ring` on interactive elements

**Implementation notes:**
- Parse text color and background color from applied Tailwind classes
- Map classes like `text-gray-600` → `rgb(75, 85, 99)` and compute contrast ratio using the WCAG formula
- Show results as a collapsible "Accessibility" section at the bottom of the inspector panel
- Color-coded: green (pass), yellow (borderline), red (fail)

---

### 🌟 5. Visual Box Model (Tailwind-Aware)

**DevTools shows raw pixel values. TailwindSight shows the Tailwind class responsible for each value.**

A visual diagram embedded at the bottom of the inspector panel:

```
┌─────────────────────────────┐
│          mt-6 (24px)        │
│  ┌───────────────────────┐  │
│  │   Border: border-2    │  │
ml-4  ├───────────────────┤  mr-4
│  │   px-6 (24px)        │  │
│  │                       │  │
│  │   py-3 (12px)        │  │
│  └───────────────────────┘  │
│          mb-4 (16px)        │
└─────────────────────────────┘
```

- Each label is clickable — clicking it jumps to that class in the class list above
- Values are derived from `getComputedStyle()` and cross-referenced with applied Tailwind classes
- Falls back to raw px values for non-Tailwind spacing

**Implementation notes:**
- Use a CSS Grid layout to render the classic box model diagram
- Map common spacing classes (`mt-*`, `p-*`, `px-*`, `py-*`, etc.) to their pixel values
- Highlight the relevant class badge in the list when a diagram region is hovered

---

## Advanced Features — v1.3.0

### 🌟 6. "Tailwind-ify Any Element"

**Works on sites that don't use Tailwind at all. No competitor does this well.**

Click any element on any website — Twitter, GitHub, Airbnb — and get a set of Tailwind classes that would reproduce its look.

**How it works:**
1. User activates "Tailwind-ify" mode (a new button in the panel or popup)
2. Hover an element → preview of suggested classes shown in a tooltip
3. Click to open the full panel with a "Generated Classes" section
4. One-click copy of the equivalent Tailwind class string

**What it converts:**
| Computed CSS | Tailwind Equivalent |
|---|---|
| `display: flex` | `flex` |
| `justify-content: space-between` | `justify-between` |
| `padding: 16px 24px` | `py-4 px-6` |
| `font-size: 14px` | `text-sm` |
| `color: rgb(99, 102, 241)` | `text-indigo-500` |
| `border-radius: 8px` | `rounded-lg` |
| `font-weight: 600` | `font-semibold` |
| `background-color: rgb(243, 244, 246)` | `bg-gray-100` |

**Implementation notes:**
- Build a comprehensive `CSS value → Tailwind class` reverse-lookup map
- Handle Tailwind's spacing scale (4px = 1, 8px = 2, 12px = 3, 16px = 4, etc.)
- Handle Tailwind's color palette by finding the nearest color match via RGB distance
- Handle shorthand properties (e.g., split `padding: 8px 16px` into `py-2 px-4`)
- Flag properties with no clean Tailwind equivalent and suggest arbitrary values instead

---

### 7. DOM Breadcrumb Trail

- 💡 Show element path in the panel header: `html > body > main > section > div`
- Each segment is clickable to inspect that ancestor
- Helps developers who aren't sure which element they clicked

### 8. Parent Class Inheritance Viewer

- 💡 Collapsible section: "Styles from parent elements"
- Lists classes on ancestor elements that affect the selected element (color inheritance, font size, flex context)
- Explains *why* a property looks the way it does even without a class on the element itself

### 9. Dark Mode Toggle

- 💡 One button adds/removes the `dark` class on `<html>`
- Instantly previews all `dark:` variant classes across the entire page
- ~10 lines of code, huge perceived value

### 10. Session Persistence

- 💡 Save class changes per URL using `chrome.storage`
- When the same page is reopened, TailwindSight re-applies the saved changes
- Shows a banner: *"3 saved edits restored from your last session"*
- Include a "clear saved edits" button

### 11. Class Diff View

- 💡 Track original classes when an element is first clicked
- Show a diff at the bottom of the panel: added classes in green, removed in red
- "Reset to original" button to revert all changes in one click

### 12. Drag to Reorder Classes

- 💡 Drag class badges to change their order in the class string
- Matters for conflict resolution — later classes in the same group win
- Visual drag handle (⠿) on the left of each badge

---

## Longer-Term Ideas — v2.0+

### Page-Wide Class Scanner
- Scan all elements on the page and show a usage dashboard
- Most-used classes, classes that appear only once (candidates for inline → component extraction)
- Identify elements that share identical class combinations → suggest componentization

### Tailwind Config Importer
- Let users paste their `tailwind.config.js` or `tailwind.config.ts`
- Unlocks custom theme colors, spacing, and breakpoints in autocomplete and validation
- Addresses a top complaint about commercial tools: they don't understand custom configs

### Component Screenshot + Class Annotation Export
- After editing, export a screenshot of the element with callouts showing which Tailwind class produces which visual aspect
- Perfect for design handoff documents and pull request descriptions

### Pseudo-State Preview
- Buttons to apply `:hover`, `:focus`, `:active` states to the selected element
- Previews `hover:`, `focus:`, `active:` variant classes without needing to manually trigger them

### Multi-Element Sync
- Select multiple elements (via Shift+Click)
- Apply a class to all selected elements simultaneously
- Great for making batch styling changes across repeated UI patterns

---

## Competitive Positioning

| Feature | TailwindSight | Tail Lens | Tailscan | Gimli | DevTools for Tailwind |
|---|---|---|---|---|---|
| Free | ✅ | ✅ (limited) | ❌ Paid | ❌ $49 | ❌ Paid |
| Class debug ("why not working?") | 🎯 | ❌ | ❌ | ❌ | ❌ |
| Inline CSS explainer | 🎯 | ❌ | ❌ | ❌ | Partial |
| Live breakpoint ruler | 🎯 | ❌ | ❌ | ❌ | ❌ |
| Accessibility checker | 🎯 | ❌ | ❌ | ❌ | ❌ |
| Visual box model (Tailwind-aware) | 🎯 | ❌ | ❌ | Partial | ❌ |
| Tailwind-ify any element | 🎯 | ❌ | ❌ | ❌ | ❌ |
| Works on non-Tailwind sites | 🎯 | ❌ | ❌ | ❌ | ❌ |
| Undo / redo | ✅ | ❌ | ❌ | ✅ | ❌ |
| Conflict detection | ✅ | ❌ | ❌ | Partial | ❌ |
| No data collection | ✅ | ✅ | ❌ | Unknown | Unknown |

---

## Build Priority Order

1. 🎯 **Class Debugger** — unique, solves the #1 developer pain point
2. 🎯 **Inline CSS Explainer** — fast to build, eliminates constant docs lookups
3. 🎯 **Live Breakpoint Ruler** — visually impressive, shareable, shows up in tutorials
4. 🎯 **Accessibility Checker** — zero competition in browser space, growing demand
5. 🎯 **Visual Box Model** — bridges visual and utility-first mental models
6. 💡 **Tailwind-ify Any Element** — expands audience beyond Tailwind-only users
7. 💡 **Dark Mode Toggle** — tiny effort, high perceived value
8. 💡 **DOM Breadcrumb** — quality-of-life for navigation
9. 💡 **Session Persistence** — makes TailwindSight a prototyping tool, not just an inspector
10. 💡 **Class Diff View** — clean complement to existing undo/redo

---

*Last updated: June 2026 | TailwindSight v1.0.0*
