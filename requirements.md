FERROUS STUDIO
UI Component Requirements
Version 1.0  |  Ferrous Labs / Entendex Ltd

1. Purpose and Scope
Ferrous Studio is a low-fidelity wireframing tool designed for speed. Its purpose is to let product owners and designers define screen structure, component configuration, and engineer-facing annotations as quickly as possible, then export the result as a structured payload consumed by an LLM.

This document defines the UI requirements for the component palette: what components exist, what properties each component exposes, and how engineer notes attach to them.

2. Design Principles
•	Speed over fidelity. Components are represented as labelled blocks, not pixel-perfect renders.
•	Everything is configurable. Every component exposes a minimal but complete property set.
•	Annotations are first-class. Engineer notes can live on individual components or at the page level.
•	Multi-screen with linking. Screens can reference one another; links are named and directional.
•	LLM-ready output. The canvas state serialises to a structured format that gives an LLM full context to generate code.

3. Canvas and Screen Management
3.1 Screen Creation Methods
Ferrous Studio supports two distinct methods for defining the screens in a project. Both methods produce the same screen objects and can be used together within a single project.

Method A: Upfront Page List
The user declares all screen names in sequence before placing any interface elements. This is the fastest way to map out the full information architecture of an application before committing to layout decisions.

Attribute	Specification
Entry mode	A dedicated project setup panel accepts a list of screen names, one per line or comma-separated. Each entry creates a blank named screen in the project.
Screen order	The order of entry defines the default sequence in the screen map. Screens can be reordered by drag-and-drop after creation.
Bulk properties	Screen type and default breakpoint can be set globally for all screens created in this pass, then overridden per screen individually.
Edit after creation	Screen names, types, and route hints remain editable at any point. Renaming a screen updates all screen link references to it automatically.
Starting canvas	Each screen created this way opens as a blank canvas ready to receive components. No nav or layout is applied by default.

Method B: Element-Driven Screen Creation
A new blank screen is created directly from a navigation-capable element on an existing screen. The user selects the element, opens its screen link property, and chooses 'Create new screen' rather than selecting an existing one.

Attribute	Specification
Trigger	Available on any element that supports a screen link: Button, Nav item, Table row action, Card, Link text.
New screen name	Prompted inline at the point of creation. Defaults to a generated name based on the triggering element label (e.g. a button labelled 'View invoice' suggests 'Invoice detail').
Link creation	The screen link between the source element and the new screen is created automatically as part of this action.
Screen position	The new screen is placed adjacent to the source screen on the screen map, with the link arrow already drawn.
Nav inheritance	The new screen inherits the navigation configuration of the source screen automatically. See Section 3.4.
Canvas state	The new screen opens as a blank canvas with only the inherited nav applied. All other layout is defined from scratch.

3.2 Screen Properties
Each screen, however it was created, carries the following properties.

Attribute	Specification
Screen name	User-defined. Used as the identifier in cross-screen links and in the exported payload.
Screen type	One of: Web (desktop), Web (mobile), Web (tablet), Modal, Drawer, Full-screen overlay.
Route hint	Optional free-text field allowing the user to note an expected URL path or route name (e.g. /dashboard/settings).
Default breakpoint	Width in pixels at which the layout is designed (defaults: 1440px desktop, 390px mobile, 768px tablet).
Parent screen	Optional reference. Recorded automatically when a screen is created via Method B. Used to determine the nav inheritance chain.
User type	One or more user types this screen is accessible to. Drawn from the project-level user type registry (see Section 3.5). Optional; unassigned screens are treated as universally accessible.

3.5 User Types
User types define the distinct roles or personas that exist within the application. They are declared at the project level and can then be assigned to any screen or group of screens. This allows the project to communicate access boundaries clearly in the LLM export and makes it easy to reason about which flows belong to which role.

Attribute	Specification
User type name	Short label for the role (e.g. Admin, Guest, Account Manager, Verified User). Required and unique within the project.
Description	Optional free-text. Describes the role's responsibilities or access level (e.g. 'Can view and edit all records; cannot manage billing').
Colour tag	A colour assigned to this user type for visual identification on the screen map. Each user type receives a distinct colour; screens assigned to that type display a colour-coded badge.
Default entry screen	Optional. The screen that a user of this type lands on after authentication or session start. Exported as the entry point for this role.

User types are assigned to screens either individually via the screen properties panel, or in bulk by selecting multiple screens on the screen map and applying a user type from the toolbar. A screen can be assigned to more than one user type (e.g. a shared dashboard visible to both Admin and Account Manager).

Note: User types are a planning and communication tool, not an access control implementation. They are exported as metadata on each screen object to inform the LLM of the intended access pattern, but enforcement logic is left to the engineering team.

3.3 Screen Linking
Components that trigger navigation (buttons, nav items, links, table row actions) can declare a link to another screen. Links are named and directional.

Attribute	Specification
Link source	The component instance initiating the navigation event.
Trigger action	One of: Click, Submit, Row action, Tab selection, Nav item selection.
Target screen	Reference to a named screen within the same project, or 'Create new screen' (see Method B above).
Link label	Short description of the navigation intent (e.g. 'Opens user profile').
Transition hint	Optional. One of: Push, Modal, Replace, Drawer open, Drawer close.

Note: Screen links are represented visually as labelled arrows on a screen map view. They are exported as a directed adjacency list in the payload.

3.4 Navigation Inheritance
When a screen is created via Method B, or when a nav component is added to any screen that has a parent screen recorded, the navigation configuration is inherited automatically from the nearest linked ancestor.

Attribute	Specification
Default behaviour	When a top nav bar or side nav is added to a screen, the studio checks for a parent screen. If one exists, the nav configuration is copied from the parent and applied to the new screen. The user is notified that inheritance is active.
Inheritance indicator	Inherited nav components are displayed with a visual marker (e.g. a chain link icon) to distinguish them from independently configured navs.
Override	The user can break inheritance at any time by selecting the nav component and choosing 'Detach from parent'. This creates an independent copy. The action requires confirmation to prevent accidental detachment.
Propagation direction	Inheritance is one-directional: changes to the parent nav propagate to all screens that have not detached. Changes to a detached child nav do not affect the parent or siblings.
Propagation trigger	When a parent nav is modified, all screens inheriting from it are updated immediately. A summary notification lists affected screens.
Deep inheritance	If screen C inherits from screen B, which inherits from screen A, C inherits the effective nav of B (which may itself be inherited or detached). The inheritance chain is shown as a breadcrumb in the nav component panel.
Modal and drawer screens	Screens of type Modal or Drawer do not inherit nav by default, as these screen types typically render without a persistent nav. This can be overridden manually.

Note: Nav inheritance applies to top nav bars, side navs, and bottom tab bars independently. A screen can inherit its top nav from a parent while having an independently configured side nav.

4. Engineer Notes System
4.1 Per-Element Annotations
Every component instance on the canvas exposes an annotation field. This is accessible via a right-click context menu or a dedicated sidebar panel when the element is selected.

Attribute	Specification
Note body	Free-text, multi-line. Supports plain text only (no rich formatting).
Note type tag	Optional classification: one of Logic, API, Validation, Accessibility, State, Open question.
Visibility	Annotations are hidden from the canvas by default; shown as a small flag icon on the element. Toggling 'Show all notes' reveals inline callouts.

4.2 Page-Level Notes Panel
Each screen has a persistent notes panel, accessible from a fixed icon in the screen toolbar. Page-level notes are not attached to a specific element and are intended for cross-cutting concerns.

Attribute	Specification
Note entries	Multiple notes can be added per screen. Each entry has a timestamp and optional author label.
Note type tag	Same tag vocabulary as per-element annotations.
Export behaviour	Page-level notes are exported as a top-level array under the screen object in the payload.

5. Input Controls
All input controls are rendered on the canvas as low-fidelity labelled blocks. Their properties define the data and behaviour context that will be passed in the LLM export.

5.1 Text Input
Attribute	Specification
Label	Visible label text. Required.
Placeholder	Ghost text shown when the field is empty.
Input type	One of: text, email, password, number, tel, url, search.
Required	Boolean. Marks the field as mandatory.
Min / Max length	Character constraints. Optional integers.
Validation rule	Free-text description of the validation logic (e.g. 'Must be a valid UK postcode').
Disabled state	Boolean. Renders the field as non-interactive.
Helper text	Secondary text rendered beneath the field (e.g. error message copy or hint).
Default value	Pre-populated value. Optional.
Multiline	Boolean. When true, the input renders as a textarea. Exposes Rows hint (integer, default 4).

5.2 Dropdown (Select)
Attribute	Specification
Label	Visible label text. Required.
Options	Comma-separated list of option labels. At least one required.
Default option	The pre-selected option. Optional; defaults to placeholder.
Placeholder	Text shown when no option is selected (e.g. 'Select a value').
Multi-select	Boolean. When true, multiple options can be chosen simultaneously.
Searchable	Boolean. When true, the dropdown includes an inline search field.
Required	Boolean.
Disabled state	Boolean.
Option source	One of: Static (defined inline), Dynamic (populated from API). If Dynamic, a source hint field appears.
Source hint	Free-text. Describes the API endpoint or data source (e.g. 'GET /api/countries').

5.3 Radio Group
Attribute	Specification
Label	Group label. Required.
Options	Comma-separated list of option labels. At least two required.
Default value	The pre-selected option. Optional.
Layout	One of: Vertical (stacked), Horizontal (inline).
Required	Boolean.
Disabled state	Boolean. Can disable the entire group or individual options (comma-separated list of disabled option labels).
Helper text	Displayed beneath the group.

5.4 Checkbox
Attribute	Specification
Label	Visible label text. Required.
Checked state	One of: Unchecked, Checked, Indeterminate.
Required	Boolean.
Disabled state	Boolean.
Helper text	Optional secondary text.
Group mode	Boolean. When true, multiple checkboxes are grouped under a shared group label. Each checkbox in the group shares the same Options list as radio groups.

5.5 Toggle / Switch
Attribute	Specification
Label	Visible label text. Required.
Default state	One of: On, Off.
Disabled state	Boolean.
On label	Optional text shown when toggled on (e.g. 'Active').
Off label	Optional text shown when toggled off (e.g. 'Inactive').

5.6 Date / Time Picker
Attribute	Specification
Label	Visible label text. Required.
Picker mode	One of: Date, Time, Date and time, Date range.
Default value	Optional ISO string or relative value (e.g. 'today', 'today + 7d').
Min date	Optional. Earliest selectable date (ISO string or relative).
Max date	Optional. Latest selectable date (ISO string or relative).
Required	Boolean.
Disabled state	Boolean.
Locale hint	Free-text. Describes expected date format convention (e.g. 'DD/MM/YYYY, UK locale').

5.7 Slider
Attribute	Specification
Label	Visible label text. Required.
Min value	Integer. Default 0.
Max value	Integer. Default 100.
Step	Integer. Increment between selectable values. Default 1.
Default value	Integer within min/max range.
Range mode	Boolean. When true, exposes two handles for selecting a range.
Show value	Boolean. When true, the current value is displayed adjacent to the handle.
Disabled state	Boolean.

5.8 File Upload
Attribute	Specification
Label	Visible label text. Required.
Accepted types	Comma-separated MIME types or extensions (e.g. '.pdf, .docx, image/*').
Max file size	Integer in MB. Optional.
Multi-file	Boolean. When true, multiple files can be attached simultaneously.
Upload hint text	Short instruction copy shown in the drop zone (e.g. 'Drag a file here or click to browse').
Required	Boolean.

5.9 Search Input
Attribute	Specification
Placeholder	Ghost text (e.g. 'Search...'). Required.
Scope hint	Free-text. Describes what is being searched (e.g. 'Searches users by name or email').
Live search	Boolean. When true, results update as the user types.
Debounce hint	Integer in milliseconds. Describes expected debounce delay if live search is enabled. Default 300.
Clear button	Boolean. Whether an inline clear/reset button is shown.
Search trigger	One of: On keystroke, On submit (Enter or button press).

5.10 Button
Attribute	Specification
Label	Button text. Required.
Variant	One of: Primary, Secondary, Tertiary, Destructive, Ghost, Icon only.
Size	One of: Small, Medium, Large.
Icon	Optional. Position: Left, Right, or None. Icon name is free-text.
Loading state	Boolean. When true, the button shows a spinner and becomes non-interactive.
Disabled state	Boolean.
Action type	One of: Submit form, Navigate, Trigger modal, Custom action.
Action hint	Free-text. Describes the action or API call triggered on click.
Screen link	Optional reference to a target screen (see Section 3.2).

5.11 Rich Text Editor
Attribute	Specification
Label	Visible label text. Required.
Toolbar options	Multi-select from: Bold, Italic, Underline, Strikethrough, Heading levels (H1-H3), Ordered list, Unordered list, Blockquote, Link, Inline code, Code block, Image, Horizontal rule.
Max characters	Integer. Optional upper limit on content length.
Placeholder	Ghost text shown in empty editor state.
Required	Boolean.
Disabled state	Boolean.
Output format hint	One of: HTML, Markdown, JSON (structured document). Describes the format expected by the consuming API.
Min height hint	Integer in pixels. Default 200.

5.12 Tag / Chip Input
Attribute	Specification
Label	Visible label text. Required.
Placeholder	Ghost text shown in the input area (e.g. 'Add a tag and press Enter').
Delimiter	One of: Enter, Comma, Space. Defines the keystroke that converts typed text into a chip.
Max tags	Integer. Optional upper limit on the number of chips.
Chip removable	Boolean. When true, each chip shows a remove icon. Default true.
Suggestions	Boolean. When true, typing shows a suggestion dropdown. Exposes option source (Static or Dynamic) matching the Dropdown spec.
Allowed values	One of: Free entry, Restricted to suggestions. When Restricted, values not in the suggestion list are rejected.
Required	Boolean.
Disabled state	Boolean.

5.13 Autocomplete / Combobox
Attribute	Specification
Label	Visible label text. Required.
Placeholder	Ghost text (e.g. 'Start typing to search...').
Option source	One of: Static (defined inline), Dynamic (populated from API).
Source hint	Free-text. Describes the API endpoint (e.g. 'GET /api/users?q={query}').
Allow new value	Boolean. When true, the user can submit a value not present in the suggestion list (combobox mode). When false, selection is restricted to existing options.
Min chars	Integer. Minimum characters typed before suggestions appear. Default 1.
Debounce hint	Integer in milliseconds. Delay before triggering a dynamic lookup. Default 300.
Multi-select	Boolean. When true, multiple values can be selected and render as chips.
Required	Boolean.
Disabled state	Boolean.

5.14 Colour Picker
Attribute	Specification
Label	Visible label text. Required.
Default value	Colour value string. Optional (e.g. '#E94560').
Format	One of: Hex, RGB, HSL. Defines the output format.
Opacity support	Boolean. When true, the picker includes an alpha/opacity channel.
Preset swatches	Boolean. When true, a row of preset colour swatches is shown. Exposes a comma-separated list of swatch values.
Input field	Boolean. When true, a text input is shown alongside the picker for direct value entry. Default true.
Required	Boolean.
Disabled state	Boolean.

5.15 Rating Input
Attribute	Specification
Label	Visible label text. Required.
Max value	Integer. Total number of rating units. Default 5.
Step	One of: Whole, Half. Whether fractional selection is allowed. Default Whole.
Icon variant	One of: Star, Heart, Thumbs, Custom. Custom exposes an icon name field.
Default value	Number within range. Optional.
Read-only	Boolean. When true, the rating is display-only and non-interactive.
Required	Boolean.
Disabled state	Boolean.

5.16 PIN / OTP Input
Attribute	Specification
Label	Visible label text. Required.
Digit count	Integer. Number of individual input segments. Typical values: 4, 6. Default 6.
Input type	One of: Numeric, Alphanumeric. Default Numeric.
Mask input	Boolean. When true, entered characters are masked (like a password field).
Auto-submit	Boolean. When true, the form is submitted automatically once all segments are filled.
Auto-focus	Boolean. When true, focus advances automatically to the next segment on entry. Default true.
Required	Boolean.
Disabled state	Boolean.

5.17 Hidden Field
A Hidden Field carries a value in the form payload but renders nothing on the canvas. It is represented as a labelled placeholder block in the studio to remain visible to the designer, but is excluded from the rendered UI.

Attribute	Specification
Field name	The key used in the form submission payload. Required.
Value source	One of: Static (hardcoded value), From context (populated at runtime). Free-text description if From context (e.g. 'Current user ID from auth session').
Static value	The hardcoded value. Only applicable when Value source is Static.
Data type	One of: String, Integer, Boolean, UUID.

6. Free Canvas
A Free Canvas is a freeform layout container. Unlike structured containers such as Forms or Data Tables, which impose an inherent layout on their children, a Free Canvas places no constraints on positioning. The user places and sizes each element individually, one at a time, at an explicit position on the canvas surface.

A Free Canvas can describe an entire screen, or it can be embedded as a zone within a screen that also contains structured containers. All input controls from Section 5 are available on a Free Canvas, alongside a set of layout primitives not available in structured containers.

6.1 Canvas Properties
Attribute	Specification
Canvas name	Internal identifier. Required when used as an embedded zone; optional when the canvas describes the entire screen.
Width hint	Integer in pixels. Describes the intended rendering width. Defaults to the screen breakpoint width.
Height hint	One of: Fixed (integer in pixels), Auto (expands to fit content). Default Auto.
Background	One of: Transparent, Solid colour (hex hint), Image placeholder. Default Transparent.
Grid overlay	Boolean. When true, a grid is shown on the canvas surface as a layout guide. Does not export.
Grid size	Integer in pixels. Size of each grid cell. Default 8. Only applicable when Grid overlay is true.
Snap to grid	Boolean. When true, elements snap to the nearest grid intersection on placement and drag. Default true.
Snap to elements	Boolean. When true, element edges snap to the edges and centres of other elements. Default true.
Overflow behaviour	One of: Clip (content outside bounds is hidden), Scroll (canvas scrolls), Visible (content bleeds). Default Visible.

6.2 Layout Model
Every element placed on a Free Canvas carries an explicit position and size. These are low-fidelity hints rather than pixel-perfect values and are intended to communicate intent to the LLM.

Attribute	Specification
X position	Integer in pixels from the left edge of the canvas. Set on placement; adjustable by drag.
Y position	Integer in pixels from the top edge of the canvas. Set on placement; adjustable by drag.
Width	Integer in pixels, or 'auto' for elements whose width is determined by content.
Height	Integer in pixels, or 'auto'.
Z-order	Integer. Determines stacking order when elements overlap. Higher values render in front. Controlled via 'Bring forward', 'Send backward', 'Bring to front', 'Send to back' actions.
Grouping	One or more elements can be grouped. A group is moved, resized, and z-ordered as a single unit. Groups can be nested. Each group has an optional label.
Alignment tools	Canvas toolbar provides: Align left edges, Align right edges, Align top edges, Align bottom edges, Align horizontal centres, Align vertical centres, Distribute horizontally, Distribute vertically. All alignment operations act on the current selection.
Lock	Boolean per element. When true, the element cannot be moved or resized by drag. It remains selectable and its properties remain editable. Used to pin background or structural elements.

6.3 Primitive Elements
The following elements are exclusive to the Free Canvas and are not available within structured containers. They carry no form or data semantics and are exported as layout and annotation hints only.

Text Block
Attribute	Specification
Content	Free-text. The copy to display. Required.
Role	One of: Heading, Subheading, Body, Label, Caption. Used as a semantic hint in the export, not a styled preset.
Alignment	One of: Left, Centre, Right, Justify.
Font size hint	Integer in pixels. Optional. Communicates intended visual hierarchy.
Font weight	One of: Regular, Medium, Bold.
Colour hint	Hex string. Optional.
Max width	Integer in pixels, or 'auto'. When set, text wraps at this width.

Shape
Attribute	Specification
Shape type	One of: Rectangle, Circle / Ellipse, Triangle, Line, Arrow.
Fill	One of: None, Solid colour (hex hint). Default None for Line and Arrow; Solid for others.
Border	Boolean. When true, exposes border colour (hex) and weight (integer, px).
Border radius	Integer in pixels. Applies to Rectangle only. Default 0.
Arrow direction	One of: Single-headed, Double-headed. Applies to Arrow only.
Label	Optional text placed inside or adjacent to the shape. Uses Text Block properties.
Opacity hint	Integer 0-100. Default 100.

Divider
Attribute	Specification
Orientation	One of: Horizontal, Vertical.
Style	One of: Solid, Dashed, Dotted.
Colour hint	Hex string. Optional.
Weight	Integer in pixels. Default 1.
Label	Optional. Short text centred on the divider line (e.g. 'or').

Spacer
Attribute	Specification
Width	Integer in pixels.
Height	Integer in pixels.
Visible on canvas	Boolean. When true, the spacer renders as a light dashed outline in the studio. Never renders in the exported UI. Default true.

Icon
Attribute	Specification
Icon name	Free-text. The name of the icon from the target icon library (e.g. 'chevron-right', 'bell', 'user-circle').
Size hint	Integer in pixels. Default 24.
Colour hint	Hex string. Optional.
Label	Optional accessible label (equivalent to aria-label). Not displayed visually.

Image Placeholder
Attribute	Specification
Alt text	Descriptive text for the image. Required.
Aspect ratio	One of: Free, Square (1:1), Landscape (16:9), Portrait (3:4), Custom (exposes width:height ratio).
Source hint	Free-text. Describes where the image comes from (e.g. 'User avatar from profile API' or 'Static asset: logo.svg').
Object fit	One of: Cover, Contain, Fill. Describes how the image fills its bounds.

Annotation Frame
Attribute	Specification
Label	Short text label displayed at the top of the frame. Required.
Description	Optional longer free-text description of the area the frame encloses.
Border style	One of: Solid, Dashed. Default Dashed.
Colour hint	Hex string. Used for border and label colour. Default a muted blue.
Fill	One of: None, Tinted (low-opacity fill using the border colour). Default None.
Export	Boolean. When true, the annotation frame is included in the export payload as a layout region with label and description. When false, it is a studio-only guide. Default true.

6.4 Input Controls on the Free Canvas
All input controls defined in Section 5 are available on a Free Canvas. They carry the same property surface as defined there. The only difference is positional: on a Free Canvas, each input is placed at an explicit X/Y position rather than flowing within a container layout. Input controls placed directly on a Free Canvas are not implicitly grouped into a form. To associate them with submission logic, they must be explicitly linked to a Form component (see Section 7) or their action hints documented in engineer notes.

7. Forms
A Form is a container component that groups input controls into a logical submission unit. It manages layout, submission behaviour, and validation orchestration.

7.1 Form Container
Attribute	Specification
Form name	Internal identifier used in the export payload.
Layout mode	One of: Single column, Two column, Grid (exposes column count).
Submit action	Free-text. Describes the API endpoint or handler (e.g. 'POST /api/users').
Submit button label	Text for the primary submit button. Default 'Submit'.
Cancel behaviour	One of: None, Navigate back, Navigate to screen (exposes screen link), Clear form.
Validation mode	One of: On submit, On blur (field-level), Live (on change).
Error display mode	One of: Inline beneath field, Summary at top, Summary at bottom, Toast.
Success behaviour	One of: Show message, Navigate to screen, Reset form. Free-text message field if applicable.
Pre-fill source	Optional. Free-text describing where default values come from (e.g. 'GET /api/user/:id').

7.2 Form Field Ordering
Fields are ordered via drag-and-drop within the form container on the canvas. The export payload preserves the visual order as an ordered array.

7.3 Fieldset / Section
A Fieldset groups related fields within a form under an optional heading. It has no submission logic of its own.

Attribute	Specification
Heading	Optional. Text label for the fieldset.
Collapsible	Boolean. When true, the fieldset can be collapsed by the user.
Default state	One of: Expanded, Collapsed. Only applicable when Collapsible is true.
Fields	Ordered list of input control instances contained within the fieldset.

8. Data Tables
Data Tables display structured row/column data with optional interaction. They are a frequently used component in B2B interfaces and have a rich configuration surface.

8.1 Table Definition
Attribute	Specification
Table name	Internal identifier.
Data source hint	Free-text. Describes the API endpoint providing row data (e.g. 'GET /api/invoices').
Empty state copy	Text displayed when no rows are returned.
Loading behaviour	One of: Skeleton rows, Spinner overlay, None.
Row density	One of: Compact, Default, Comfortable.
Sticky header	Boolean. When true, the column header row stays visible on scroll.
Horizontal scroll	Boolean. When true, the table scrolls horizontally on overflow.

8.2 Column Definition
Each column is defined individually. Columns are ordered by drag-and-drop.

Attribute	Specification
Column label	Header text displayed to the user.
Column key	Data field name in the source object (e.g. 'invoice_number').
Width hint	One of: Auto, Fixed (px), Fraction (%). Optional.
Data type	One of: Text, Number, Currency, Date, Boolean, Badge/Status, Avatar + name, Link, Custom.
Sortable	Boolean. Whether clicking the column header sorts the data.
Filterable	Boolean. Whether a filter control is shown for this column.
Truncate	Boolean. Whether long values are truncated with a tooltip on hover.
Alignment	One of: Left, Centre, Right.
Format hint	Free-text. Describes any formatting logic (e.g. 'Currency in GBP, 2dp').

8.3 Row Interaction
Attribute	Specification
Row selection	One of: None, Single (radio), Multi (checkbox).
Row click action	One of: None, Navigate, Open drawer, Open modal. Exposes screen link or action hint.
Bulk actions	List of actions available when multiple rows are selected. Only active when Row selection is Multi. Each bulk action exposes a label, variant, and action hint.

8.3a Row Action Patterns
Row actions define the interactive controls rendered within each row. Three distinct patterns are supported and can be used independently or in combination.

Inline Buttons
Attribute	Specification
Usage	One or two always-visible buttons rendered directly in the row. Best for a single primary action (e.g. Edit).
Actions list	Ordered list. Each entry has: Label, Variant (Primary, Secondary, Destructive, Ghost), Size (Small, Medium), Icon (optional, name free-text), Action hint (free-text), Screen link (optional).
Max recommended	2. More than two inline buttons should be moved to a dropdown.
Visibility rule	One of: Always visible, On row hover. Default: Always visible.

Icon Buttons
Attribute	Specification
Usage	Compact icon-only actions rendered inline. Suitable for common operations where the icon is universally understood (e.g. delete, download, duplicate).
Actions list	Ordered list. Each entry has: Icon name (free-text, required), Tooltip label (required for accessibility), Variant (Default, Destructive), Action hint (free-text), Screen link (optional).
Visibility rule	One of: Always visible, On row hover. Default: On row hover.
Grouping	Boolean. When true, icon buttons are visually grouped in a bordered cluster.

Actions Dropdown (Kebab Menu)
Attribute	Specification
Usage	A trigger button (typically a three-dot or chevron icon) that opens a contextual menu of actions. Use when there are three or more actions, or when actions include destructive options.
Trigger icon	One of: Three-dot (kebab), Chevron down, Custom. Custom exposes an icon name field.
Trigger label	Optional text label alongside the trigger icon.
Menu items	Ordered list. Each entry has: Label, Icon (optional), Action hint, Screen link (optional), Destructive flag (Boolean, renders item in a danger colour), Divider before (Boolean, inserts a visual separator above this item).
Placement	One of: Bottom-right (default), Bottom-left, Top-right, Top-left.

Conditional Visibility
Any row action (across all three patterns) can be conditionally shown or hidden based on row data. This is expressed as a free-text logic hint.

Attribute	Specification
Visibility condition	Free-text. Describes the row data condition under which the action is shown (e.g. 'Shown only when row.status === Pending').
Hidden vs. disabled	One of: Hidden (action is not rendered), Disabled (action is rendered but non-interactive). Specifies the visual treatment when the condition is not met.
Tooltip when disabled	Optional free-text. Explains why the action is unavailable (e.g. 'Only available for active records').

8.4 Table Toolbar
Attribute	Specification
Global search	Boolean. Whether a search field above the table filters rows.
Filter panel	Boolean. Whether a filter drawer or inline filter controls are exposed.
Column picker	Boolean. Whether the user can show/hide columns.
Export	Boolean. Whether an export (CSV/XLSX) button is shown.
Add record	Boolean. Whether a primary action button to create a new record is shown. Exposes label and action hint.
Pagination	One of: None, Page-based (exposes page size options), Infinite scroll, Load more button.
Page size	Comma-separated list of available page size options (e.g. '10, 25, 50'). Default 25.

9. Card Lists
Card Lists display a collection of items as visual cards. They are an alternative to data tables when a more spatial or media-rich presentation is appropriate.

9.1 Card List Container
Attribute	Specification
Container name	Internal identifier.
Data source hint	Free-text. Describes the API endpoint (e.g. 'GET /api/products').
Layout mode	One of: Grid, List (single column), Masonry.
Columns	Integer. Number of columns in Grid mode (responsive hint; e.g. '3 desktop, 2 tablet, 1 mobile').
Card gap	One of: None, Small, Medium, Large.
Empty state copy	Text shown when no cards are returned.
Loading behaviour	One of: Skeleton cards, Spinner, None.
Pagination	One of: None, Page-based, Infinite scroll, Load more button.
Sorting	Boolean. Whether a sort control is shown above the list.
Filtering	Boolean. Whether filter controls are shown.

9.2 Card Template
Each card is built from a configurable set of slots. Slots that are not enabled are omitted from the export payload.

Attribute	Specification
Media slot	Boolean. When enabled: position (Top, Left, Right, Background), aspect ratio, and image source hint.
Eyebrow slot	Boolean. Short category or tag text above the title.
Title slot	Boolean. Primary heading text. Required if card has no media.
Subtitle slot	Boolean. Secondary text below the title.
Body slot	Boolean. Main descriptive text. Exposes max-lines truncation hint.
Metadata slot	Boolean. Key/value pairs rendered as small labelled items (e.g. Date, Author, Price). Number of pairs: 1 to 6.
Badge/status slot	Boolean. One or more status badges. Exposes badge labels and colour semantics (e.g. Success, Warning, Error, Neutral).
Actions slot	Boolean. One or more buttons or icon actions at the card footer. Reuses Button component spec (Section 5.10).
Selection mode	One of: None, Single, Multi. Renders a checkbox or radio on the card.
Card click action	One of: None, Navigate, Open modal, Open drawer. Exposes screen link or action hint.

10. Navigation Components
10.1 Top Navigation Bar
The top nav bar is a persistent horizontal strip rendered at the top of the viewport. It is defined once per screen type (desktop, mobile, tablet). When added to a screen, it inherits configuration from the nearest linked ancestor screen unless inheritance has been detached (see Section 3.4).

Attribute	Specification
Logo slot	Boolean. Exposes a logo label (alt text hint) and a home screen link reference.
Nav items	Ordered list of navigation items. Each item has: Label, Screen link (optional), Active state logic hint (free-text), Icon (optional).
Dropdown menus	Boolean per nav item. When true, exposes a nested list of sub-items with the same item structure.
CTA slot	Boolean. One or more buttons in the far right of the bar. Reuses Button component spec.
User menu slot	Boolean. An avatar/user badge that opens a dropdown. Exposes a list of menu items with labels and action hints.
Search slot	Boolean. Embeds a Search Input (Section 5.9) in the nav bar.
Notification slot	Boolean. A bell icon with optional badge count. Exposes action hint (e.g. 'Opens notification drawer').
Sticky behaviour	One of: Fixed (always visible), Sticky (visible until scrolled past), Static.
Mobile collapse mode	One of: Hamburger menu, Bottom tab bar, Hidden. Describes how the nav renders on mobile breakpoints.
Background	One of: Solid, Transparent, Blur/frosted glass.
Height hint	Integer in pixels. Default 64.

10.2 Side Navigation
The side nav is a vertical panel rendered on the left (or optionally right) side of the layout. Most commonly used in dashboard and admin interfaces. Like the top nav, it inherits from the nearest linked ancestor screen unless detached (see Section 3.4).

Attribute	Specification
Position	One of: Left, Right.
Default width hint	Integer in pixels. Default 240.
Collapsed width hint	Integer in pixels. Default 64. Used when the nav is in icon-only mode.
Collapsible	Boolean. Whether the user can collapse the nav to icon-only mode.
Default state	One of: Expanded, Collapsed.
Logo / workspace slot	Boolean. An optional header area for brand mark or workspace switcher.
Nav groups	The nav is divided into groups. Each group has: Group label (optional), ordered list of Nav items.
Nav item	Each item has: Label, Icon (name, free-text), Screen link (optional), Active state logic hint, Badge count (boolean).
Nested items	Boolean per nav item. When true, exposes a collapsible sub-list with the same Nav item structure.
Footer slot	Boolean. Optional fixed area at the bottom of the nav for secondary items (e.g. Settings, Help, Log out).
Overlay mode	Boolean. When true, the nav overlays content on smaller viewports rather than pushing it.
Z-index behaviour	One of: Pushes content, Overlays content. Relevant for responsive breakpoints.

10.3 Mobile Bottom Tab Bar
An alternative primary navigation pattern for mobile screens, rendered as a fixed bar at the bottom of the viewport. Follows the same inheritance rules as the top nav and side nav (see Section 3.4).

Attribute	Specification
Tabs	Ordered list of tab items. Each item has: Label, Icon (name, free-text), Screen link, Active state logic hint. Maximum 5 items.
Label visibility	One of: Always visible, Hidden, Active tab only.
Badge support	Boolean. Whether individual tabs can show a notification count badge.

11. Schema Linking
Schema Linking connects forms, data tables, and card lists that represent the same underlying data entity. Rather than specifying fields and columns independently on each component, a shared schema object acts as the single source of truth.

11.1 Shared Schema Object
A Schema is a named, reusable entity defined at the project level. Any form, data table, or card list can reference a schema instead of defining its fields from scratch.

Attribute	Specification
Schema name	Unique identifier within the project (e.g. 'Invoice', 'User', 'Product').
Description	Optional free-text. Describes what entity the schema represents.
Fields	Ordered list of field definitions. Each field is the canonical definition used to generate form inputs, table columns, or card slots.

11.2 Schema Field Definition
Each field in a schema carries enough information to determine its appropriate UI representation in any consuming component.

Attribute	Specification
Field name	The data key as it appears in the API payload (e.g. 'invoice_number').
Display label	The human-readable label shown to users (e.g. 'Invoice Number').
Data type	One of: Text, Number, Currency, Date, DateTime, Boolean, Enum, UUID, Email, URL, RichText, File, Colour.
Enum values	Comma-separated list. Only applicable when Data type is Enum (e.g. 'Draft, Sent, Paid, Overdue').
Required	Boolean. Whether this field is mandatory in form contexts.
Read-only	Boolean. When true, the field is always shown as display-only (never editable).
Nullable	Boolean. Whether the field can hold a null/empty value.
Default value	Optional. The value pre-populated in form contexts.
Validation hint	Free-text. Describes any validation rules (e.g. 'Must be a valid IBAN').
Format hint	Free-text. Describes display formatting in table/card contexts (e.g. 'GBP currency, 2dp').
Form component	The recommended input control type when this field is rendered in a form. Defaults are inferred from Data type but can be overridden (e.g. Enum defaults to Dropdown, can be changed to Radio Group).
Table column type	The recommended column data type when this field is rendered in a table. Defaults are inferred from Data type.
Card slot	One of: Title, Subtitle, Body, Eyebrow, Metadata, Badge/status, Media, None. The card template slot this field maps to.
Visible in form	Boolean. Whether this field is included when generating a form from the schema. Default true.
Visible in table	Boolean. Whether this field is included as a column when generating a table from the schema. Default true.
Visible in card	Boolean. Whether this field is included when generating a card template from the schema. Default true.

11.3 Generate Form from Schema
A form can be scaffolded directly from a schema. The studio creates one input control per schema field marked as Visible in form, using the Form component type defined on each field. Field order follows the schema field order and can be overridden by drag-and-drop within the form.

Attribute	Specification
Source schema	Reference to the named schema. Required.
Operation mode	One of: Create (blank form), Edit (pre-filled via pre-fill source). Drives the submit action hint.
Excluded fields	Optional list of field names to omit from the generated form (overrides Visible in form).
Field overrides	Per-field property overrides applied after generation (e.g. changing a Dropdown to a Radio Group for a specific field).
Sync behaviour	One of: Live sync (form updates when schema changes), Snapshot (form is generated once and becomes independent). Default Snapshot.

Note: When Sync behaviour is Live sync, field overrides are preserved on schema change but may need manual review if the relevant field definition changes significantly.

11.4 Generate Table from Schema
A data table can be scaffolded from a schema. One column is created per schema field marked as Visible in table, using the Table column type defined on each field.

Attribute	Specification
Source schema	Reference to the named schema. Required.
Excluded fields	Optional list of field names to omit from the generated table columns.
Column overrides	Per-column property overrides applied after generation (e.g. changing alignment, adding a format hint).
Sync behaviour	One of: Live sync, Snapshot. Default Snapshot.

11.5 Generate Card Template from Schema
A card list template can be scaffolded from a schema. Fields marked as Visible in card are mapped to card slots using the Card slot value on each field definition.

Attribute	Specification
Source schema	Reference to the named schema. Required.
Excluded fields	Optional list of field names to omit from the card template.
Slot overrides	Per-field slot reassignment after generation (e.g. moving a field from Metadata to Subtitle).
Sync behaviour	One of: Live sync, Snapshot. Default Snapshot.

11.6 Reverse Generation: Table or Card List to Form
Where a schema does not yet exist, a form can be generated from an existing table or card list definition. This creates a new schema derived from the source component's column or slot definitions, then generates a linked form from that schema.

Attribute	Specification
Source component	Reference to an existing data table or card list in the project.
Derived schema	A new schema is created automatically. The user is prompted to name it and review the inferred field definitions before generation proceeds.
Post-generation	The source table or card list is retroactively linked to the derived schema. Sync behaviour defaults to Snapshot.

12. Export Payload Notes
The export payload is out of scope for this document. However, the component specifications above define the complete data surface that the export must capture. The following conventions apply to all components:

•	Every component instance carries a unique id (UUID), a component type, a position and size on the canvas, and a properties object matching the spec tables above.
•	Engineer notes (per-element and page-level) are included in the payload as a notes array on each object, with type tag, body text, and optional author.
•	Screen links are represented as a links array on the source component, each with source component id, trigger action, target screen name, link label, and optional transition hint.
•	Page-level notes are included as a top-level notes array on the screen object.
•	Component order within containers (forms, nav groups, card lists) is exported as an ordered array, preserving drag-and-drop sequence.

Note: Property values that are left at their default in the studio may be omitted from the payload, or included with an 'isDefault: true' flag. This is a decision for the export specification document.

Ferrous Labs / Entendex Ltd  |  Ferrous Studio UI Requirements v1.0  |  Confidential
