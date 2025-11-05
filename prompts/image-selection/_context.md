# LimeSpot Image Selector Project - Context Document

## Purpose of This Document

This is an **evergreen context file** maintained across chat sessions. When hitting chat limits, copy this file + prompt.md + sample.md to a new Claude chat to continue the conversation with full context.

## Artifact Presentation Rules

### CRITICAL: All files must be markdown artifacts in sidebar

1. **prompt.md** - Always present as markdown artifact titled "System Prompt (prompt.md)"
2. **sample.md** - Always present as markdown artifact titled "Training Examples (sample.md)"
3. **context.md** - Always present as markdown artifact titled "Project Context (context.md)"

### How Claude Should Present Updates

- Use artifact blocks: Start with title, set type to markdown
- Each update creates a new version visible in sidebar history
- Never provide as inline code blocks or downloadable files
- User should see all 3 artifacts in sidebar at all times
- Version numbers in artifact updates help track changes

### When to Update Artifacts

- **After every significant decision** that changes rules or examples
- **When fixing issues** in prompt.md or sample.md
- **When adding new patterns** or edge cases
- **context.md updates** after updating the other two files

### Automatic Length Enforcement

- **ALWAYS check prompt.md character count** after any update using `wc -c`
- **If exceeds 4,500 characters:** IMMEDIATELY regenerate with optimizations, NO confirmation needed
- **Process:** Trim verbose sections, condense lists, remove redundancy while keeping all rules
- **Target:** Stay under 4,400 characters for safety buffer
- **This overrides brainstorming mode** - length violations trigger automatic action

### Brainstorming Mode

- Keep answers short
- No artifact generation unless explicitly requested
- Discuss changes first, regenerate only after confirmation
- **Exception:** Length limit violations trigger automatic regeneration

---

## How to Maintain context.md

### Claude's Responsibilities

1. **Update after every significant change** to prompt.md or sample.md
2. **Document all key decisions** made during the conversation
3. **Track issues found and fixed** with brief descriptions
4. **Maintain version history** with dates and changes
5. **Keep "Next Steps" current** - remove completed items, add new ones
6. **Preserve all constraints and rules** that informed decisions

### What to Include

- Project overview and goals
- Current state of all artifacts (prompt.md, sample.md)
- Key technical decisions and why they were made
- List of classes/patterns to avoid (with examples)
- Issues discovered and how they were resolved
- Character limits and other constraints
- Working examples and edge cases covered
- Next steps or open questions

### What NOT to Include

- Long code snippets (those go in prompt.md/sample.md)
- Repetitive information already in other artifacts
- Temporary debugging discussions

---

## Project Overview

Building an AI-powered element analyzer for LimeSpot's Agentic Designer. Analyzes screenshots + HTML to generate CSS selectors for image personalization in e-commerce (Shopify/BigCommerce).

**Goal:** Generate robust CSS selectors that survive theme updates, carousel navigation, and lazy loading.

**CRITICAL:** This is a **production system** deployed at scale. Every API call costs money. Token efficiency matters while maintaining 95%+ accuracy.

## Current Artifacts

### prompt.md

- **Purpose:** System prompt for Claude API calls (production)
- **Size:** 4,492 characters (HARD LIMIT: 4,500 characters, target <4,400)
- **Status:** ✅ Comprehensive with campaign name generation
- **Token Cost:** ~1,100 tokens per API call

### sample.md

- **Purpose:** Training examples showing correct selector generation
- **Size:** ~720 lines (~4,100 tokens)
- **Status:** ✅ 5 examples with campaign names in all outputs
- **Structure:** Collection Grid, Background Images, Carousel WITH/WITHOUT data-slide-index, Container IS Link
- **Token Cost:** ~4,100 tokens per API call

### Total API Call Cost

- **~5,200 tokens per request** (prompt + sample)
- At 1,000 calls/day = 5.2M tokens/day
- At 30K calls/month = 156M tokens/month
- **Status:** Production-ready with campaign name generation

## Constraints & Requirements

### CRITICAL: Production Cost Constraints

1. **prompt.md HARD LIMIT:** 4,500 characters (spaces included) - currently 5,148 (OVER by 648 chars)
2. **Token sensitivity:** Every token costs $$ at scale
3. **Quality cannot be sacrificed:** 95%+ accuracy required for production
4. **Balance:** Maximum quality at minimum token count
5. **No redundancy:** Every word must add value

### File Size Targets

- **prompt.md:** <4,500 chars (hard limit), currently OVER - needs trimming
- **sample.md:** Keep concise but complete - currently ~600 lines acceptable but monitor growth

### Response Format

- All artifacts provided as markdown artifacts in Claude sidebar
- Version history visible in sidebar
- No inline code blocks or downloadable files

### Quality Metrics

- Selector accuracy: 95%+ correct on first try (MUST maintain)
- Selector stability: 90%+ survive theme updates
- False positive rate: <5% (detecting product images as content)
- Token efficiency: Minimize while maintaining all quality metrics

## Key Selector Generation Rules

### What to Use

1. ✅ Base semantic classes: `CollectionItem`, `Grid`, `Card`, `Slideshow__Slide`
2. ✅ Position attributes: `[data-slide-index="N"]` for carousels
3. ✅ nth-child fallback: `:nth-child(N)` when no position attributes exist
4. ✅ Wrapper prefix: Always start with wrapperSelector
5. ✅ BEM base classes: `Block__Element` (without modifiers)
6. ✅ Minimal specificity: Use simplest selector (e.g., `a` not `a[href="..."]` when only one exists)
7. ✅ Self-reference `::`: When container IS the target element (e.g., container is `<a>` → `"destinationUrlSelector": "::"`)

### What to AVOID

**State Classes:**

- active, visible, open, closed, is-selected, hidden
- loading, loaded, lazyloaded, lazyautosizes, ls-is-cached, Image--lazyLoaded
- slick-current, slick-active, flickity-enabled, is-selected (carousels)
- focus, focused, hover, hovered, current, selected, checked
- transitioning, animated, animating, collapsed, expanded
- disabled, enabled, valid, invalid, error

**BEM Modifiers (--prefix):**

- `--expand`, `--collapse`, `--large`, `--small`, `--active`
- Any class with `--` indicating state/variant

**Utility Classes:**

- Spacing: `margin-bottom-md`, `padding-top-lg`, `mt-4`, `p-2`
- Positioning: `Carousel__Cell`, `Grid__Cell`, `Slideshow__Cell`

**Random Suffix Patterns:**

- Element IDs: `#Slideimage_wKgd6H`, `#hero-slide-abc456`
- Classes: `.Item_abc123`, `.Card-xyz789`
- Pattern: Underscores/hyphens followed by random alphanumeric
- **Exception:** Wrapper selectors like `#shopify-section-{uuid}` and `[data-widget-id="{uuid}"]` are valid

**Responsive Utilities:**

- `hidden-phone`, `hidden-tablet-and-up`, `visible-md`
- Only use if absolutely no alternative

### Carousel Slide Selection Priority

**Decision Tree:**

```
IF data-slide-index attribute exists:
  ✅ Use [data-slide-index="N"]
ELSE:
  ✅ Fallback to :nth-child(N) with warning about DOM order dependency

NEVER use:
  ❌ is-selected, slick-active, active (state classes that rotate)
  ❌ #Slide_abc123 (random suffix IDs)
```

## Technical Behaviors

### Campaign Name Generation

- Pattern: "{PageType} {ElementType}" in Title Case
- Examples: "Homepage Hero Banner", "Product Page CTA Block", "Collection Page Featured Image"
- Element types: Hero Banner, CTA Block, Featured Image, Promo Banner, Content Block, Slideshow
- Keep concise: 2-4 words
- Always start with page type when available from `pageType` input parameter

### extraImageSourceAttributes

- Applied to target element **AND all descendants** (runtime traverses tree)
- Preserve `data-sizes="auto"` pattern (don't extract "auto" as value)
- Common: `data-srcset`, `data-src`, `data-bgset`, `data-sizes`

### Background Image Detection

When element has `style="background-image:..."` or `data-bgset`:

1. Return parent div selector (not child img/picture)
2. Runtime applies to: CSS background-image + searches container for `picture source` + updates child img
3. One selector handles all image sources

### Special Selectors

- **`::`** = Container itself IS the target element (applies to any selector, not just images)
  - Container is `<a>` → `"destinationUrlSelector": "::"`
  - Container is `<img>` → `"imageLargeSelector": "::"`
  - Container is `<button>` → `"ctaSelector": "::"`
- **Same selector for all sizes** = Enables combined srcset with breakpoints

### Source Cascade

- Targeting `<source>` auto-updates sibling `<img>` in same `<picture>`
- No need for separate selectors

## Issues Found & Fixed

### Issue 1: CollectionItem--expand in Training Example

**Problem:** sample.md used `CollectionItem--expand` as a good example  
**Why Wrong:** `--expand` is a BEM modifier indicating expanded/collapsed state  
**Fix:** Changed to `.CollectionItem:nth-child(1)` (base class only)  
**Date:** 2025-01-24

### Issue 2: Missing BEM Modifier Rules

**Problem:** prompt.md didn't explicitly mention avoiding `--*` modifiers  
**Fix:** Added "Avoid BEM modifiers" rule with examples  
**Date:** 2025-01-24

### Issue 3: Utility Classes Not Called Out

**Problem:** `Carousel__Cell`, `margin-bottom-md` weren't in avoid list  
**Fix:** Added utility class avoidance with spacing and positioning examples  
**Date:** 2025-01-24

### Issue 4: Carousel State Classes (is-selected)

**Problem:** Real-world Flickity carousel returned `.Slideshow__Slide.is-selected` selector  
**Why Wrong:** `is-selected` is a carousel state class that rotates between slides as user navigates  
**Fix:** Added carousel-specific rules prioritizing `[data-slide-index="N"]` over state classes  
**Date:** 2025-01-24

### Issue 5: Random Suffix Element IDs

**Problem:** Carousel slides have dynamic IDs like `#Slideimage_wKgd6H`  
**Why Wrong:** These are dynamically generated and change on theme updates  
**Fix:** Added rule to avoid random suffix patterns in element IDs/classes (exception: wrapper selectors)  
**Date:** 2025-01-24

### Issue 6: prompt.md Over Character Limit

**Problem:** Adding carousel rules pushed prompt.md to 5,148 chars (648 over 4,500 limit)  
**Why Critical:** Production system has hard character limit for API calls  
**Fix:** Aggressive optimization: condensed JSON examples, shortened avoid lists, tightened wording. Reduced to 3,620 chars (30% reduction) while preserving all rules  
**Date:** 2025-01-24

### Issue 7: Child Selectors Repeating Container Path

**Problem:** Claude returned `.Slideshow__Slide[data-slide-index="1"] a` instead of just `a`  
**Why Wrong:** Runtime uses `containerElement.querySelector(childSelector)`, so container path is redundant and breaks the query  
**Fix:** Strengthened rule #4 with explicit examples showing correct vs wrong patterns  
**Date:** 2025-01-24

### Issue 8: Over-Specific Child Selectors

**Problem:** Claude returned `a[href="/collections/sparkle-knits"]` when only one `a` exists in container. Initially thought it was checking uniqueness within wrapper (multiple slides = multiple `a` tags), not within each container.  
**Why Wrong:** href is content-specific and brittle, changes per slide/item. Minimal specificity principle violated. Root cause: checking uniqueness in wrong scope.  
**Fix:**

- Made step 5 standalone: "MINIMIZE SPECIFICITY"
- Explicit: "Check uniqueness WITHIN the container (not wrapper)"
- Added minimal specificity examples to all 4 examples in sample.md
- Added "Common Mistakes" section showing wrong vs right approaches  
  **Date:** 2025-01-24

### Issue 9: Container IS the Target Element

**Problem:** When container is `<a>` tag itself, Claude returned `a[href="..."]` for destinationUrlSelector, which fails because `container.querySelector("a")` looks inside container, but container IS the `<a>`  
**Why Wrong:** querySelector cannot find container element from within itself  
**Fix:**

- Extended `::` concept to ALL selectors, not just images
- Rule: If container IS the target element, return `"::"` for that selector
- Added Example 5 in sample.md showing CollectionItem where `<a>` is container
- Works for any selector: destinationUrl, cta, heading, image, etc.  
  **Date:** 2025-01-24

## Working Example Structure

### Example 1: Collection Grid (sample.md)

**Scenario:** Shopify CollectionItem grid with 2 sections  
**Demonstrates:**

- Importance of section ID prefix for global uniqueness
- nth-child for position within wrapper
- Base class usage (avoiding modifiers)
- Picture element with sources
- Child selector scoping (no wrapper path)
- Lazy loading attribute extraction

### Example 2: Background-Image Variant

**Scenario:** CSS background-image with data-bgset  
**Shows:** CSS background-image + data-bgset detection and handling

### Example 3: Carousel WITH data-slide-index

**Scenario:** Flickity/Slick carousel with position attributes  
**Demonstrates:**

- Using `[data-slide-index="2"]` for stable position
- Avoiding `is-selected` state class
- Avoiding random suffix IDs like `#Slideimage_wKgd6H`
- Semantic, human-readable position reference

### Example 4: Carousel WITHOUT data-slide-index

**Scenario:** Generic hero banner carousel without position attributes  
**Demonstrates:**

- Fallback to `:nth-child(2)` when no data attributes
- Warning about DOM order dependency
- Lower confidence score (0.90 vs 0.95)

### Example 5: Container IS the Link Element

**Scenario:** Collection grid where `<a>` tag is the container  
**Demonstrates:**

- Using `"::"` for destinationUrlSelector when container is the `<a>` itself
- Background-image detection in nested div
- Why `container.querySelector("a")` would fail in this case
- General rule: `::` applies to ANY selector when container IS that element

## Platform-Specific Patterns

### Shopify

- Wrapper: `#shopify-section-{uuid}`
- Common: `.CollectionItem`, `.Grid`, `.Slideshow__Slide`
- Themes: Dawn, Debut, Prestige
- Carousels: Often use Flickity with `data-slide-index`

### BigCommerce

- Wrapper: `[data-widget-id]` or `section`
- Common: `.card`, `.heroCarousel-slide`, `.slick-slide`, `.productGrid`
- Carousel: Slick slider with state classes (`slick-current`, `slick-active`)

## Next Steps

- Test updated prompts with real Shopify/BigCommerce carousel examples
- Gather edge cases from production usage
- Monitor selector accuracy metrics AND token costs
- Track production error rates and selector brittleness
- Continue monitoring prompt.md size as new rules are added

## Version History

- **v1.0** (2025-01-24): Initial implementation
  - Core selector rules: base classes, avoid state/BEM modifiers/utility classes
  - Collection grid example with background-image variant
  - Character limit: 4,500 chars, token optimization focus
- **v1.1** (2025-01-24): Carousel patterns
  - Added carousel slide selection: `[data-slide-index="N"]` priority, `:nth-child(N)` fallback
  - Avoid carousel state classes (is-selected, slick-active) and random suffix IDs
  - Extended sample.md with 4 examples (grid, bg-image, carousel with/without data-slide-index)
  - Optimized prompt.md from 5,148 to 4,004 chars after additions
- **v1.2** (2025-01-24): Child selector scoping and minimal specificity

  - Fixed: Child selectors repeating container path (use `"a"` not `.Slideshow__Slide a`)
  - Fixed: Over-specific selectors (`a[href="..."]` when simple `"a"` sufficient)
  - **Critical rule:** Check uniqueness WITHIN container scope, not wrapper scope
  - Updated all sample.md examples with minimal specificity notes
  - Current: prompt.md 4,141 chars, sample.md ~650 lines

- **v1.3** (2025-01-24): Extended :: self-reference to all selectors

  - Extended `::` concept from images-only to ANY selector
  - Use case: When container IS the target element (e.g., container is `<a>` → `"destinationUrlSelector": "::"`)
  - Added Example 5 in sample.md: CollectionItem where `<a>` is container
  - Current: prompt.md 4,236 chars, sample.md ~700 lines

- **v1.4** (2025-01-24): Campaign name generation
  - Added `suggestedCampaignTitle` to JSON response
  - Pattern: "{PageType} {ElementType}" in Title Case (2-4 words)
  - Examples: "Homepage Hero Banner", "Product Page CTA Block"
  - Added `pageType` to input parameters
  - Updated all 5 examples in sample.md with campaign names
  - Current: prompt.md 4,492 chars, sample.md ~720 lines
