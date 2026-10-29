// One DOM insertion/layout/removal for all labels, rather than one forced
// table reflow per qualifier. Equal text/font combinations share a probe.
export function measureInlineTextWidths(elements) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:max-content;';
  const probes = new Map(), labels = new Map();
  for (const element of elements) {
    if (!element) continue;
    const style = getComputedStyle(element);
    const text = element.value ?? element.textContent;
    const key = JSON.stringify([text, style.font, style.letterSpacing, style.textTransform]);
    if (!probes.has(key)) {
      const probe = document.createElement('span');
      probe.style.cssText = 'display:block;width:max-content;white-space:nowrap;';
      probe.style.font = style.font;
      probe.style.letterSpacing = style.letterSpacing;
      probe.style.textTransform = style.textTransform;
      probe.textContent = text;
      host.appendChild(probe);
      probes.set(key, probe);
    }
    labels.set(element, key);
  }
  if (!labels.size) return new Map();
  document.body.appendChild(host);
  try {
    const widths = new Map([...probes].map(([key, probe]) => [key, probe.offsetWidth]));
    return new Map([...labels].map(([element, key]) => [element, widths.get(key)]));
  } finally { host.remove(); }
}
