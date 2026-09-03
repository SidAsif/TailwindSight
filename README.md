# TailwindSight

A powerful Chrome extension that lets you visually inspect, edit, and modify Tailwind CSS classes directly on any webpage in real-time.

## Features

### Core Functionality

- **Visual Element Inspection** - Click on any element to view and edit its Tailwind classes
- **Live Class Modification** - Add or remove classes with instant visual feedback
- **Smart Autocomplete** - Get intelligent suggestions as you type class names
- **Class Validation** - Real-time validation ensures you only add valid Tailwind classes
- **Active/Inactive Indicators** - Visual dots show which classes are active (●) or overridden (○)
- **Conflict Detection** - Automatically detects and marks conflicting classes (e.g., `md:text-3xl` vs `md:text-4xl`)

### Developer Tools

- **"Why isn't this class working?" Debugger** - Classes with a real problem flag themselves with an amber icon before you click anything. Click for a plain-English diagnosis: viewport too narrow for the responsive prefix, superseded by an active responsive variant, overridden by a conflicting class (named, with the exact property), blocked by an inline style, or beaten by a page stylesheet rule
- **Inline CSS Explainer** - Hover any class to see the exact CSS it generates, including media queries for responsive prefixes
- **Live Breakpoint Ruler** - A bar at the top of the page shows the live viewport width and highlights the active breakpoint as you resize. Breakpoints are read from the page's own stylesheets, so projects with a custom `screens` config get their real values
- **Copy for AI** - One click copies a structured context block ready to paste into Claude, ChatGPT, or Cursor: element HTML, classes, any detected issues, computed styles, the detected Tailwind version, the page's real breakpoints, the live colour scheme, and viewport state

### Advanced Features

- **Undo/Redo Support** - Full history tracking for all class modifications
- **Copy Classes** - One-click copy of all classes to clipboard
- **Responsive Prefixes** - Full support for `sm:`, `md:`, `lg:`, `xl:`, `2xl:` and any custom breakpoint names defined in your config
- **State Variants** - Works with `hover:`, `focus:`, `active:`, `dark:`, and other modifiers
- **Opacity Modifiers** - Supports opacity syntax like `text-gray-600/90`
- **Arbitrary Values** - Compatible with arbitrary values like `text-[#ff0000]`
- **Important Modifier** - Handles `!` prefix for important classes

### User Experience

- **Professional Dark Theme** - Clean, modern interface that doesn't distract
- **Smooth Animations** - Polished transitions for better UX
- **Improved Scrollbars** - Enhanced scrollbar design for better usability
- **Toast Notifications** - Non-intrusive success/error messages
- **Error Highlighting** - Clear feedback for invalid class names

## Installation

### From Chrome Web Store

1. Visit the [TailwindSight Chrome Web Store page](#)
2. Click "Add to Chrome"
3. Click "Add extension" in the popup

### Manual Installation (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked"
5. Select the extension directory

## Usage

1. **Activate the Extension**

   - Click the TailwindSight icon in your browser toolbar
   - Click "Start Inspecting" button

2. **Inspect Elements**

   - Click on any element on the webpage
   - The inspector panel will appear showing all Tailwind classes

3. **Modify Classes**

   - **Add**: Type in the input field and click "Add Class" or select from autocomplete
   - **Remove**: Click the "x" button next to any class
   - **Undo/Redo**: Use the undo/redo buttons to revert changes
   - **Copy**: Click the copy button to copy all classes to clipboard

4. **Understanding Indicators**
   - **Green Dot (●)**: Class is active and working
   - **Gray Dot (○)**: Class is inactive or overridden by another class

## Supported Tailwind Patterns

- ✅ Basic classes: `flex`, `bg-blue-500`, `text-center`
- ✅ Responsive: `md:text-4xl`, `lg:flex`, `sm:hidden`
- ✅ State variants: `hover:bg-red-500`, `focus:ring-2`, `dark:text-white`
- ✅ Opacity modifiers: `bg-black/50`, `text-gray-600/90`
- ✅ Arbitrary values: `text-[#1da1f2]`, `w-[137px]`
- ✅ Important: `!text-center`, `!hidden`
- ✅ Combined modifiers: `md:hover:text-4xl`, `lg:dark:bg-slate-900`

## Keyboard Shortcuts

- `Enter` - Add the class from the input field
- `Escape` - Unwinds one layer at a time: closes open autocomplete suggestions, then clears a filled input, then closes the inspector panel

## Permissions Explained

- **activeTab** - Access the currently active webpage
- **storage** - Save inspection state across sessions
- **host_permissions: <all_urls>** - Allow inspection on any webpage

## Technical Details

- **Manifest Version**: 3
- **Minimum Chrome Version**: 88+
- **Tailwind CSS Version Support**: v3 and v4 (detected automatically; v4's `@layer`-wrapped utilities and `(width >= 40rem)` range media queries are both understood)
- **Framework**: Vanilla JavaScript (no dependencies)

## Privacy

TailwindSight does not:

- Collect any personal data
- Track your browsing history
- Send data to external servers
- Store any information outside your browser

All operations are performed locally in your browser.

## Support & Feedback

- **Issues**: [GitHub Issues](https://github.com/SidAsif/TailwindSight/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/SidAsif/TailwindSight/discussions)
- **Email**: asifsidcontact@gmail.com

## Changelog

### Version 1.2.0 (Current)

- **"Why isn't this class working?" Debugger** — one-click diagnosis for any class: responsive prefix vs viewport, named class conflicts with the exact property, inline style overrides, and page stylesheet overrides verified against computed styles
- **Inline CSS Explainer** — hover any class in the panel to see the CSS it generates
- **Live Breakpoint Ruler** — real-time viewport width + active breakpoint bar while inspecting
- **Copy for AI** — copies element HTML, classes, detected issues, computed styles, detected Tailwind version, real breakpoints, live colour scheme, and viewport context as a ready-to-paste AI prompt
- Smarter conflict detection: font-weight, text-align, and position conflicts now detected; `text-5xl` vs `text-pretty` style false positives fixed

**Accuracy**

- Breakpoints are now read from the page's own stylesheets instead of being hardcoded, so a custom `screens` config no longer produces wrong answers in the ruler, the debugger, or the AI context. Understands both v3's `(min-width: 640px)` and v4's `(width >= 40rem)` range syntax, and descends into the `@layer` blocks v4 wraps its utilities in
- The Tailwind major version (v3 or v4) is detected from the page and stated in the AI context, so an assistant doesn't hand back syntax that silently doesn't work
- Fixed a false positive that fired on one of Tailwind's most common patterns: `text-5xl sm:text-6xl` above the `sm` breakpoint was reported as a page stylesheet override with higher specificity, when the responsive variant was simply doing its job. It now reports as expected behaviour rather than a problem
- The live colour scheme (and how it's set) is included in the AI context, so `dark:` classes no longer look broken when the page is rendering light
- Trimmed meaningless lines from the captured computed styles — flex properties on non-flex elements, `position: static`, `overflow: visible`, and shorthands like `border: 0px none rgb(0, 0, 0)`

**Fixes and polish**

- Removed the Google Fonts `@import` from the injected stylesheet — it was blocked by the extension CSP (so it never applied) while still requesting `fonts.googleapis.com` from every page you visited. Now uses a system font stack; no page you visit makes an outbound request
- Enter in the "Add new class" field now adds the class — previously only the Add Class button worked
- Escape now unwinds one layer at a time: open suggestions, then a filled input, then the panel — it no longer discards your selection while you are mid-edit
- Debug icons now flag problems up front: a class the debugger finds a real issue with shows an amber icon without being clicked, and healthy classes return an "Applied" result instead of silently doing nothing
- Panel header rebuilt: grouped undo/redo, copy and close actions, hover and focus states that actually render, undo/redo disabled at the ends of history, and `aria-label`s on every control
- Redesigned the diagnosis card to match the panel — neutral surface, status dot, and a plain-language verdict label instead of an alert-style colour block
- Redesigned the popup: live inspection status, state-aware button, keyboard hint, and a privacy link
- Removed a `console.log` that ran on every page you visited, whether or not you were inspecting

### Version 1.1.0

- Escape key closes the inspector panel
- Class count badge in panel header (`ClassList (n)`)
- Filter input to search within applied classes
- Copy Element HTML button (`</>`) — copies full `outerHTML` to clipboard

### Version 1.0.0

- Initial release
- Visual element inspection
- Add/remove Tailwind classes
- Autocomplete suggestions
- Class validation
- Undo/redo functionality
- Active/inactive indicators
- Conflict detection
- Dark theme UI

## Roadmap

- Accessibility / WCAG contrast checker
- Design consistency scanner (inconsistent radii, spacing, colors across the page)
- Visual box model (Tailwind-aware)
- Edit session diff + export
- Dark mode toggle
- Session persistence (restore edits on page reload)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this extension in your projects.

## Author

**Md Asif Siddiqui**

- GitHub: [@SidAsif](https://github.com/SidAsif)

---

Made with ⚡ for the Tailwind CSS community
