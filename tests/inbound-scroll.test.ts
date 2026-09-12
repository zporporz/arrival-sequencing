import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Vitest stubs CSS imports, including ?raw. Read the real files for this contract.
const liveCss = readFileSync(resolve('src/live.css'), 'utf8')
const systemCss = readFileSync(resolve('src/systemPanelRuntime.css'), 'utf8')
const responsiveCss = readFileSync(resolve('src/responsiveOperational.css'), 'utf8')

function stylesheet(css: string) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  return style
}

afterEach(() => {
  document.head.querySelectorAll('style').forEach(style => style.remove())
  document.body.replaceChildren()
})

describe('Inbound scroll layout contract', () => {
  it('shrinks the list below its fixed header instead of clipping a full-height list', () => {
    stylesheet(liveCss)
    stylesheet(systemCss)
    document.body.innerHTML = `<aside class="aman-side-stack">
      <section class="aman-panel aman-inbound-panel">
        <div class="aman-panel-header compact">Inbound</div>
        <div class="aman-inbound-list"><div class="aman-inbound-head">APT ACID</div></div>
      </section>
      <section class="aman-system-panel is-runtime-collapsible">SYSTEM</section>
    </aside>`
    const panel = getComputedStyle(document.querySelector('.aman-inbound-panel')!)
    const header = getComputedStyle(document.querySelector('.aman-panel-header')!)
    const list = getComputedStyle(document.querySelector('.aman-inbound-list')!)
    expect(panel.display).toBe('flex')
    expect(panel.flexDirection).toBe('column')
    expect(header.flexShrink).toBe('0')
    // jsdom's CSS parser drops the unitless-zero flex shorthand. The browser
    // scroll check verifies its computed flex-basis and actual scroll bounds.
    expect(systemCss).toMatch(/\.aman-inbound-panel>\.aman-inbound-list\s*\{\s*flex:\s*1 1 0;/)
    expect(list.minHeight).toBe('0px')
    expect(list.height).toBe('auto')
    expect(list.overflow).toBe('auto')
    expect(getComputedStyle(document.querySelector('.aman-inbound-head')!).position).toBe('sticky')
    // The final row can sit above the 38px SYSTEM bar and its two 8px gaps.
    expect(panel.paddingBottom).toBe('54px')
  })

  it('does not reserve the desktop SYSTEM bar twice in the mobile drawer', () => {
    // jsdom does not perform viewport layout/media matching. Check this override
    // here; real browser checks cover desktop wheel + mobile keyboard scrolling.
    const style = stylesheet(responsiveCss)
    const rules = Array.from(style.sheet!.cssRules)
    const responsive = rules.find(rule => rule.type === CSSRule.MEDIA_RULE && (rule as CSSMediaRule).conditionText.includes('1100px')) as CSSMediaRule
    const drawer = Array.from(responsive.cssRules).find(rule =>
      rule.type === CSSRule.STYLE_RULE && (rule as CSSStyleRule).selectorText === '.aman-inbound-panel.is-mobile-open') as CSSStyleRule
    expect(drawer.style.getPropertyValue('padding-bottom')).toBe('0px')
  })
})
