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

### Advanced Features

- **Undo/Redo Support** - Full history tracking for all class modifications
- **Copy Classes** - One-click copy of all classes to clipboard
- **Responsive Prefixes** - Full support for `sm:`, `md:`, `lg:`, `xl:`, `2xl:` prefixes
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

- `Enter` - Add class from input field
- `Escape` - Close inspector panel (coming soon)

## Permissions Explained

- **tabs** - Required to interact with the current tab
- **activeTab** - Access the currently active webpage
- **storage** - Save inspection state across sessions
- **host_permissions: <all_urls>** - Allow inspection on any webpage

## Technical Details

- **Manifest Version**: 3
- **Minimum Chrome Version**: 88+
- **Tailwind CSS Version Support**: All versions
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

### Version 1.0.0 (Current)

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

Future features under consideration:

- Keyboard shortcuts for common actions
- Export/import class sets
- Class history per element
- Custom class presets
- Multi-element selection
- Integration with Tailwind config

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this extension in your projects.

## Author

**Md Asif Siddiqui**

- GitHub: [@SidAsif](https://github.com/SidAsif)

---

Made with ⚡ for the Tailwind CSS community
