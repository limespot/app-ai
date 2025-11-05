# Training Examples

## Overview

This file contains multiple scenarios showing correct selector generation across different e-commerce patterns:

1. **Collection Grid** - Multiple sections with similar items (demonstrates section ID importance)
2. **Background Image Variant** - CSS background-image detection
3. **Carousel WITH data-slide-index** - Flickity/Slick with position attributes
4. **Carousel WITHOUT data-slide-index** - Generic carousel using nth-child fallback

---

## Example 1: Collection Grid

### Scenario

User clicks on forest image with "OUR COMMITMENTS" heading in a Shopify collection grid. Page has TWO sections with similar CollectionItem structures. Target is in the SECOND section.

### Full Page Context

**Complete HTML (showing both sections):**

```html
<!doctype html>
<html>
  <body>
    <main id="MainContent">
      <!-- FIRST SECTION - Not the target -->
      <div id="shopify-section-abc123" class="shopify-section">
        <div class="CollectionList">
          <div class="CollectionItem margin-bottom-md Carousel__Cell">
            <a href="/collections/shoes">
              <div class="CollectionItem__Image Image--zoomOut hide-no-js">
                <img src="shoes.jpg" alt="" />
              </div>
              <div class="CollectionItem__Content">
                <h2 class="SectionHeader__Heading">FOOTWEAR</h2>
              </div>
            </a>
          </div>

          <div class="CollectionItem margin-bottom-md Carousel__Cell">
            <a href="/collections/bags">
              <div class="CollectionItem__Image Image--zoomOut hide-no-js">
                <img src="bags.jpg" alt="" />
              </div>
              <div class="CollectionItem__Content">
                <h2 class="SectionHeader__Heading">ACCESSORIES</h2>
              </div>
            </a>
          </div>
        </div>
      </div>

      <!-- SECOND SECTION - TARGET IS HERE -->
      <div id="shopify-section-xyz789" class="shopify-section">
        <div class="CollectionList">
          <!-- TARGET ITEM -->
          <div class="CollectionItem margin-bottom-md CollectionItem--expand Carousel__Cell">
            <a href="/pages/planet">
              <div class="CollectionItem__Image Image--zoomOut hide-no-js">
                <picture>
                  <source
                    data-srcset="forest-750.webp 750w, forest-1000.webp 1000w"
                    srcset="forest-750.webp 750w, forest-1000.webp 1000w"
                  />
                  <img src="forest.jpg" alt="" />
                </picture>
              </div>
              <div class="CollectionItem__Content">
                <h2 class="SectionHeader__Heading">OUR COMMITMENTS</h2>
                <p class="SectionHeader__SubHeading">DO RIGHT BY THE PLANET</p>
              </div>
            </a>
          </div>

          <div class="CollectionItem margin-bottom-md Carousel__Cell">
            <a href="/pages/people">
              <div class="CollectionItem__Image Image--zoomOut hide-no-js">
                <img src="ocean.jpg" alt="" />
              </div>
              <div class="CollectionItem__Content">
                <h2 class="SectionHeader__Heading">OUR PEOPLE</h2>
              </div>
            </a>
          </div>

          <div class="CollectionItem margin-bottom-md Carousel__Cell">
            <a href="/pages/quality">
              <div class="CollectionItem__Image Image--zoomOut hide-no-js">
                <img src="mountains.jpg" alt="" />
              </div>
              <div class="CollectionItem__Content">
                <h2 class="SectionHeader__Heading">QUALITY CRAFT</h2>
              </div>
            </a>
          </div>
        </div>
      </div>

      <!-- THIRD SECTION - Carousel WITH data-slide-index -->
      <div id="shopify-section-template--17727205998772__slideshow_9wrcem" class="shopify-section">
        <section data-section-type="slideshow">
          <div class="Slideshow">
            <div class="Slideshow__Carousel Carousel flickity-enabled">
              <!-- SLIDE 1 -->
              <div
                id="Slideimage_MmUReB"
                class="Slideshow__Slide Carousel__Cell"
                data-slide-index="0"
              >
                <a href="/collections/velvet-edit">
                  <div class="Slideshow__ImageContainer AspectRatio hidden-tablet-and-up">
                    <img
                      class="Slideshow__Image"
                      src="mobile-velvet.jpg"
                      data-src="mobile-velvet-800.jpg"
                      alt=""
                    />
                  </div>
                  <div class="Slideshow__ImageContainer AspectRatio hidden-phone">
                    <img
                      class="Slideshow__Image"
                      data-srcset="velvet-400.jpg 400w, velvet-800.jpg 800w"
                      data-sizes="auto"
                      alt=""
                    />
                  </div>
                </a>
              </div>

              <!-- SLIDE 2 -->
              <div
                id="Slideimage_qg8fWr"
                class="Slideshow__Slide Carousel__Cell"
                data-slide-index="1"
              >
                <a href="/collections/autumn-outfits">
                  <div class="Slideshow__ImageContainer AspectRatio hidden-tablet-and-up">
                    <img
                      class="Slideshow__Image"
                      src="mobile-autumn.jpg"
                      data-src="mobile-autumn-800.jpg"
                      alt=""
                    />
                  </div>
                  <div class="Slideshow__ImageContainer AspectRatio hidden-phone">
                    <img
                      class="Slideshow__Image"
                      data-srcset="autumn-400.jpg 400w, autumn-800.jpg 800w"
                      data-sizes="auto"
                      alt=""
                    />
                  </div>
                </a>
              </div>

              <!-- SLIDE 3 - TARGET -->
              <div
                id="Slideimage_wKgd6H"
                class="Slideshow__Slide Carousel__Cell is-selected"
                data-slide-index="2"
              >
                <a href="/collections/all-dresses">
                  <div class="Slideshow__ImageContainer AspectRatio hidden-tablet-and-up">
                    <img
                      class="Slideshow__Image"
                      src="mobile-dresses.jpg"
                      data-src="mobile-dresses-800.jpg"
                      alt=""
                    />
                  </div>
                  <div class="Slideshow__ImageContainer AspectRatio hidden-phone">
                    <img
                      class="Slideshow__Image"
                      data-srcset="dresses-400.jpg 400w, dresses-800.jpg 800w"
                      data-sizes="auto"
                      alt=""
                    />
                  </div>
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- FOURTH SECTION - Carousel WITHOUT data-slide-index -->
      <div id="shopify-section-hero-banner-abc" class="shopify-section">
        <div class="HeroBanner">
          <div class="HeroBanner__Slider">
            <!-- SLIDE 1 -->
            <div id="hero-slide-xyz123" class="HeroBanner__Slide">
              <a href="/collections/new">
                <div class="HeroBanner__ImageWrapper">
                  <img class="HeroBanner__Image" src="new-arrivals.jpg" alt="" />
                </div>
              </a>
            </div>

            <!-- SLIDE 2 - TARGET -->
            <div id="hero-slide-abc456" class="HeroBanner__Slide active">
              <a href="/collections/sale">
                <div class="HeroBanner__ImageWrapper">
                  <img class="HeroBanner__Image" src="sale.jpg" data-src="sale-large.jpg" alt="" />
                </div>
              </a>
            </div>

            <!-- SLIDE 3 -->
            <div id="hero-slide-def789" class="HeroBanner__Slide">
              <a href="/collections/featured">
                <div class="HeroBanner__ImageWrapper">
                  <img class="HeroBanner__Image" src="featured.jpg" alt="" />
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  </body>
</html>
```

**Why this matters:** Four distinct sections demonstrate different selector strategies across common e-commerce patterns.

---

### Example 1 Analysis: Collection Grid

**Screenshot Description:** Forest landscape with "OUR COMMITMENTS" heading

**What Browser Sends:**

```json
{
  "platform": "Shopify",
  "wrapperSelector": "#shopify-section-xyz789",
  "wrapperHTML": "<div id=\"shopify-section-xyz789\" class=\"shopify-section\">...</div>",
  "screenshot": "[base64 forest image]",
  "clickPosition": { "x": 350, "y": 280 }
}
```

**Correct Analysis:**

- Visual: Forest image with heading text overlay
- Container: First CollectionItem in section `#shopify-section-xyz789`
- Position: `:nth-child(1)` for specificity
- **Avoid:** `CollectionItem--expand` (state modifier), `Carousel__Cell` (utility)

**Correct Output:**

```json
{
  "confidence": 0.95,
  "containerSelector": "#shopify-section-xyz789 .CollectionList > div.CollectionItem:nth-child(1)",
  "suggestedCampaignTitle": "Homepage Featured Collection",
  "imageLargeSelector": ".CollectionItem__Image picture img",
  "imageMediumSelector": ".CollectionItem__Image picture source",
  "imageSmallSelector": ".CollectionItem__Image picture source",
  "headingSelector": ".CollectionItem__Content .SectionHeader__Heading",
  "subheadingSelector": ".CollectionItem__Content .SectionHeader__SubHeading",
  "ctaSelector": null,
  "destinationUrlSelector": "a",
  "extraImageSourceAttributes": "data-srcset, srcset",
  "suggestions": [
    "Used section ID to isolate from other sections",
    "Used base semantic class CollectionItem, avoiding state modifiers like --expand",
    "Added nth-child(1) for position specificity within CollectionList",
    "Used minimal selector 'a' - only one link exists within this container"
  ],
  "warnings": [],
  "reasoning": "Target found in first CollectionItem of section #shopify-section-xyz789. Section ID prevents matching items from #shopify-section-abc123. Used base class only, avoiding state modifiers (--expand) and utility classes (Carousel__Cell, margin-bottom-md). Child selectors use minimal specificity - 'a' not 'a[href=\"/pages/planet\"]' because only one link exists in this container (uniqueness checked within container scope, not wrapper)."
}
```

---

## Example 2: Background Image Variant

**Scenario:** Same collection structure, but image uses CSS `background-image` with `data-bgset` for responsive variants.

**HTML Structure:**

```html
<div class="CollectionItem__ImageWrapper">
  <div
    class="CollectionItem__Image Image--zoomOut hide-no-js Image--lazyLoaded"
    style='background-position: right bottom; background-image: url("forest_1000x.webp");'
    data-optimumx="1.4"
    data-expand="-150"
    data-bgset="forest_750x960.webp 750w, forest_1000x.webp 1000w, forest_1500x.webp 1500w"
  >
    <picture style="display: none;">
      <source data-srcset="forest_750x960.webp 750w, forest_1000x.webp 1000w" sizes="790px" />
      <img alt="" class="lazyautosizes Image--lazyLoaded" data-sizes="auto" data-optimumx="1.4" />
    </picture>
  </div>
</div>
```

**Key Observations:**

1. Parent div has inline `background-image` CSS
2. `data-bgset` contains responsive variants
3. Picture element is hidden (`display: none`)
4. Runtime applies to BOTH CSS background-image AND nested picture/img

**Correct Output:**

```json
{
  "imageLargeSelector": ".CollectionItem__ImageWrapper .CollectionItem__Image",
  "imageMediumSelector": ".CollectionItem__ImageWrapper .CollectionItem__Image",
  "imageSmallSelector": ".CollectionItem__ImageWrapper .CollectionItem__Image",
  "extraImageSourceAttributes": "data-bgset, data-srcset, data-optimumx, data-sizes"
}
```

**Why:** Return parent div selector (`.CollectionItem__Image`) that has the background-image. Runtime handles both CSS background + child picture/img elements.

---

## Example 3: Carousel WITH data-slide-index

**Scenario:** User clicks on third slide in Flickity carousel. Carousel uses `data-slide-index` attributes for stable positioning.

**Screenshot Description:** Dresses collection banner image

**What Browser Sends:**

```json
{
  "platform": "Shopify",
  "wrapperSelector": "#shopify-section-template--17727205998772__slideshow_9wrcem",
  "wrapperHTML": "<div id=\"shopify-section-template--17727205998772__slideshow_9wrcem\">...</div>",
  "screenshot": "[base64 dresses image]",
  "clickPosition": { "x": 450, "y": 300 }
}
```

**Correct Analysis:**

- Visual: Dresses collection banner
- Container: Third slide in carousel (`.Slideshow__Slide`)
- Position indicator: `data-slide-index="2"` present
- **Avoid:** `is-selected` (carousel state), `#Slideimage_wKgd6H` (random suffix ID)
- **Use:** `[data-slide-index="2"]` for stable position reference

**Correct Output:**

```json
{
  "confidence": 0.95,
  "containerSelector": "#shopify-section-template--17727205998772__slideshow_9wrcem .Slideshow__Slide[data-slide-index=\"2\"]",
  "suggestedCampaignTitle": "Homepage Hero Banner",
  "imageLargeSelector": ".Slideshow__ImageContainer.hidden-phone .Slideshow__Image",
  "imageMediumSelector": ".Slideshow__ImageContainer.hidden-phone .Slideshow__Image",
  "imageSmallSelector": ".Slideshow__ImageContainer.hidden-tablet-and-up .Slideshow__Image",
  "headingSelector": null,
  "subheadingSelector": null,
  "ctaSelector": null,
  "destinationUrlSelector": "a",
  "extraImageSourceAttributes": "data-srcset, data-src, data-sizes",
  "suggestions": [
    "Used data-slide-index attribute for stable carousel position",
    "Avoided is-selected state class which rotates between slides",
    "Avoided random suffix ID #Slideimage_wKgd6H which is dynamically generated",
    "Used minimal selector 'a' - only one link exists within this container"
  ],
  "warnings": [],
  "reasoning": "Target is 3rd slide in Flickity carousel. Used data-slide-index='2' for position specificity instead of is-selected state class (changes as carousel rotates) or random ID (unstable across theme updates). Attribute-based selector is semantic and matches human description ('the 2nd slider image'). Child selectors use minimal specificity - 'a' not 'a[href=\"/collections/all-dresses\"]' because only one link exists in this container."
}
```

**Why data-slide-index over alternatives:**

❌ **Wrong:** `.Slideshow__Slide.is-selected` - State class that rotates  
❌ **Wrong:** `#Slideimage_wKgd6H` - Random suffix, dynamically generated  
✅ **Correct:** `[data-slide-index="2"]` - Stable, semantic position reference

**Why minimal specificity matters:**

❌ **Wrong:** `"destinationUrlSelector": "a[href='/collections/all-dresses']"` - Over-specific, href changes per slide  
✅ **Correct:** `"destinationUrlSelector": "a"` - Only one `a` in this container

The wrapper has 3 slides, each with an `a` tag (different hrefs). But uniqueness is checked WITHIN each container, not across the wrapper. Since each container has only one `a`, use the simple selector `"a"`.

---

## Example 4: Carousel WITHOUT data-slide-index

**Scenario:** User clicks on second slide in generic hero banner carousel. No `data-slide-index` attribute exists.

**Screenshot Description:** Sale collection banner

**What Browser Sends:**

```json
{
  "platform": "Shopify",
  "wrapperSelector": "#shopify-section-hero-banner-abc",
  "wrapperHTML": "<div id=\"shopify-section-hero-banner-abc\">...</div>",
  "screenshot": "[base64 sale image]",
  "clickPosition": { "x": 500, "y": 350 }
}
```

**Correct Analysis:**

- Visual: Sale banner image
- Container: Second slide in HeroBanner
- Position indicator: No `data-slide-index` attribute
- **Avoid:** `active` (carousel state), `#hero-slide-abc456` (random suffix ID)
- **Fallback:** Use `:nth-child(2)` for position

**Correct Output:**

```json
{
  "confidence": 0.9,
  "containerSelector": "#shopify-section-hero-banner-abc .HeroBanner__Slide:nth-child(2)",
  "suggestedCampaignTitle": "Homepage Hero Banner",
  "imageLargeSelector": ".HeroBanner__ImageWrapper .HeroBanner__Image",
  "imageMediumSelector": ".HeroBanner__ImageWrapper .HeroBanner__Image",
  "imageSmallSelector": ".HeroBanner__ImageWrapper .HeroBanner__Image",
  "headingSelector": null,
  "subheadingSelector": null,
  "ctaSelector": null,
  "destinationUrlSelector": "a",
  "extraImageSourceAttributes": "data-src",
  "suggestions": [
    "Used nth-child fallback as no data-slide-index attribute exists",
    "Avoided active state class which changes as carousel rotates",
    "Avoided random suffix ID which is dynamically generated",
    "Used minimal selector 'a' - only one link exists within this container"
  ],
  "warnings": [
    "Using nth-child assumes stable DOM order - selector may break if slide order changes"
  ],
  "reasoning": "Target is 2nd slide in carousel without data-slide-index. Fallback to nth-child(2) for position. Avoided active state class (carousel rotation state) and random ID #hero-slide-abc456 (unstable). Lower confidence (0.90) due to nth-child brittleness if DOM order changes. Child selectors use minimal specificity - 'a' not 'a[href=\"/collections/sale\"]' because only one link exists in this container."
}
```

**Decision Tree for Carousel Slides:**

```
IF data-slide-index exists:
  ✅ Use [data-slide-index="N"]
ELSE:
  ✅ Use :nth-child(N) with warning about DOM order dependency

NEVER use:
  ❌ is-selected, slick-active, active (state classes)
  ❌ #Slide_abc123 (random suffix IDs)
```

**Child Selector Minimal Specificity:**

Check uniqueness WITHIN the container, not the wrapper. Even if wrapper contains multiple slides with multiple `a` tags total, if each container has only one `a`, use simple `"a"` selector.

---

## Example 5: Container IS the Link Element

**Scenario:** Collection grid where each item is wrapped in an `<a>` tag. The best container is the `<a>` element itself, not a parent div.

**HTML Structure:**

```html
<div id="shopify-section-template--17727205998772__collection_list_VE9kgH" class="shopify-section">
  <section data-section-type="collection-list">
    <div class="CollectionList">
      <!-- Item 1 -->
      <a href="/collections/velvet-edit" class="CollectionItem Carousel__Cell">
        <div class="CollectionItem__Wrapper">
          <div class="CollectionItem__ImageWrapper">
            <div class="CollectionItem__Image" data-bgset="...">
              <picture style="display: none;">
                <source data-srcset="..." />
                <img alt="" />
              </picture>
            </div>
          </div>
          <div class="CollectionItem__Content">
            <h2 class="SectionHeader__Heading">Evening Elegance</h2>
            <span class="CollectionItem__Link Button">Shop now</span>
          </div>
        </div>
      </a>

      <!-- Item 2 -->
      <a href="/collections/holidaywear" class="CollectionItem Carousel__Cell">
        <div class="CollectionItem__Wrapper">
          <div class="CollectionItem__ImageWrapper">
            <div class="CollectionItem__Image" data-bgset="...">
              <picture style="display: none;">
                <source data-srcset="..." />
                <img alt="" />
              </picture>
            </div>
          </div>
          <div class="CollectionItem__Content">
            <h2 class="SectionHeader__Heading">Winter Sun</h2>
            <span class="CollectionItem__Link Button">shop now</span>
          </div>
        </div>
      </a>

      <!-- Item 3 - TARGET -->
      <a href="/collections/boots" class="CollectionItem Carousel__Cell">
        <div class="CollectionItem__Wrapper">
          <div class="CollectionItem__ImageWrapper">
            <div class="CollectionItem__Image" data-bgset="...">
              <picture style="display: none;">
                <source data-srcset="..." />
                <img alt="" />
              </picture>
            </div>
          </div>
          <div class="CollectionItem__Content">
            <h2 class="SectionHeader__Heading">Boot up</h2>
            <span class="CollectionItem__Link Button">SHop now</span>
          </div>
        </div>
      </a>
    </div>
  </section>
</div>
```

**Screenshot Description:** Boots collection image with "Boot up" heading

**What Browser Sends:**

```json
{
  "platform": "Shopify",
  "wrapperSelector": "#shopify-section-template--17727205998772__collection_list_VE9kgH",
  "wrapperHTML": "<div id=\"shopify-section-template--17727205998772__collection_list_VE9kgH\">...</div>",
  "screenshot": "[base64 boots image]",
  "clickPosition": { "x": 400, "y": 350 }
}
```

**Correct Analysis:**

- Visual: Boots collection image with heading
- Container: Third CollectionItem, which is the `<a>` tag itself
- **Key insight:** Since container IS the `<a>` element, `destinationUrlSelector` should be `"::"` not `"a"`
- Using `container.querySelector("a")` would fail - container itself is the link

**Correct Output:**

```json
{
  "confidence": 0.95,
  "containerSelector": "#shopify-section-template--17727205998772__collection_list_VE9kgH .CollectionItem:nth-child(3)",
  "suggestedCampaignTitle": "Homepage Featured Collection",
  "imageLargeSelector": ".CollectionItem__ImageWrapper .CollectionItem__Image",
  "imageMediumSelector": ".CollectionItem__ImageWrapper .CollectionItem__Image",
  "imageSmallSelector": ".CollectionItem__ImageWrapper .CollectionItem__Image",
  "headingSelector": ".SectionHeader__Heading",
  "subheadingSelector": null,
  "ctaSelector": ".CollectionItem__Link",
  "destinationUrlSelector": "::",
  "extraImageSourceAttributes": "data-bgset, data-srcset, data-optimumx, data-sizes",
  "suggestions": [
    "Container is the <a> element itself, so destinationUrlSelector uses '::'",
    "Used nth-child(3) for position specificity",
    "Detected background-image usage in CollectionItem__Image"
  ],
  "warnings": [],
  "reasoning": "Target is 3rd CollectionItem in grid. Container selector points to the <a> tag itself (.CollectionItem is applied to <a>). Since container IS the link element, destinationUrlSelector returns '::' instead of 'a' - using container.querySelector('a') would fail because the container itself is the <a> tag. This pattern applies to any selector when container IS the target element."
}
```

**Why :: for destinationUrlSelector:**

❌ **Wrong:** `"destinationUrlSelector": "a"` - Would fail because `container.querySelector("a")` looks for `<a>` inside container, but container itself is the `<a>`  
❌ **Wrong:** `"destinationUrlSelector": "a[href='/collections/boots']"` - Same issue, plus over-specific  
✅ **Correct:** `"destinationUrlSelector": "::"` - Tells runtime to use container element itself

**General Rule for ::**

Use `"::"` for any selector when container IS that element:

- Container is `<a>` → `"destinationUrlSelector": "::"`
- Container is `<img>` → `"imageLargeSelector": "::"`
- Container is `<button>` → `"ctaSelector": "::"`
- Container is any element → corresponding selector can be `"::"`

---

## Common Mistakes to Avoid

**Over-Specific Child Selectors (WRONG):**

❌ `"destinationUrlSelector": "a[href='/collections/dresses']"` - href changes per item  
✅ `"destinationUrlSelector": "a"` - only one `a` in container

❌ `"headingSelector": "h2.SectionHeader__Heading.Heading--lg"` - unnecessary classes  
✅ `"headingSelector": ".SectionHeader__Heading"` - sufficient specificity

❌ `"imageLargeSelector": "div.CollectionItem__Image.Image--zoomOut picture img"` - over-qualified  
✅ `"imageLargeSelector": ".CollectionItem__Image picture img"` - cleaner

**Remember:** Check uniqueness WITHIN container scope, not wrapper. If wrapper has 10 items each with one `a` tag, use `"a"` for each container - don't add `href` specificity.

**State/Transient Classes (NEVER use):**

- Interaction: `active`, `hover`, `focus`, `current`, `selected`, `checked`
- Visibility: `visible`, `hidden`, `open`, `closed`, `collapsed`, `expanded`
- Loading: `loading`, `loaded`, `lazyloaded`, `lazyautosizes`, `ls-is-cached`, `Image--lazyLoaded`
- Carousel: `slick-current`, `slick-active`, `is-selected`, `flickity-enabled`
- Form: `disabled`, `enabled`, `valid`, `invalid`, `error`
- Animation: `transitioning`, `animated`, `animating`

**BEM Modifiers (NEVER use):**

- `--expand`, `--collapse`, `--large`, `--small`, `--active`

**Utility/Framework Classes (AVOID):**

- Spacing: `margin-bottom-md`, `padding-top-lg`, `mt-4`, `p-2`
- Positioning: `Carousel__Cell`, `Grid__Cell`, `Slideshow__Cell`

**Random Suffix Patterns (NEVER use):**

- Element IDs: `#Slideimage_wKgd6H`, `#hero-slide-abc456`
- Classes: `.Item_abc123`, `.Card-xyz789`
- **Exception:** Wrapper selectors like `#shopify-section-{uuid}` are valid

**Responsive Utilities (AVOID unless no alternative):**

- `hidden-phone`, `hidden-tablet-and-up`, `visible-md`

---

## Summary of Selector Strategies

1. **Collection Grids:** Section ID + base class + nth-child
2. **Background Images:** Return parent div with `background-image` or `data-bgset`
3. **Carousels with data-slide-index:** Use `[data-slide-index="N"]`
4. **Carousels without data-slide-index:** Fallback to `:nth-child(N)` with warning
5. **Random Suffixes:** Only acceptable in wrapper selectors, never in element IDs/classes
