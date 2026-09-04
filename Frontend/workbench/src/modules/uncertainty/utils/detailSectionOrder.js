export const DETAIL_SECTION_IDS = ["instruments", "equation", "budget"];

export const normalizeDetailSectionOrder = (order = []) => {
  const valid = new Set(DETAIL_SECTION_IDS);
  const normalized = [];

  (Array.isArray(order) ? order : []).forEach((sectionId) => {
    if (valid.has(sectionId) && !normalized.includes(sectionId)) {
      normalized.push(sectionId);
    }
  });

  DETAIL_SECTION_IDS.forEach((sectionId) => {
    if (!normalized.includes(sectionId)) normalized.push(sectionId);
  });
  return normalized;
};

export const moveDetailSection = (order, activeId, targetId) => {
  const normalized = normalizeDetailSectionOrder(order);
  const fromIndex = normalized.indexOf(activeId);
  const toIndex = normalized.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return normalized;

  const next = [...normalized];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

export const detailSectionOrderValue = (order, sectionId, offset = 0) => {
  const index = normalizeDetailSectionOrder(order).indexOf(sectionId);
  return (index < 0 ? DETAIL_SECTION_IDS.length : index) * 10 + offset;
};
