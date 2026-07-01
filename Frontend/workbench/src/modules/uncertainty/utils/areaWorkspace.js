export const resolveAreaWorkspacePoint = (
  testPoints,
  selectedPointId,
  areaId,
) => {
  const points = testPoints || [];
  const selectedPoint = points.find((point) => point.id === selectedPointId);

  if (selectedPoint?.measurementAreaId === areaId) {
    return selectedPoint;
  }

  return points.find((point) => point.measurementAreaId === areaId) || null;
};

export const associateUutWithPoint = (testPoints, pointId, uutId) =>
  (testPoints || []).map((point) => {
    if (point.id !== pointId) return point;

    return {
      ...point,
      associatedUutIds: [
        ...new Set([...(point.associatedUutIds || []), uutId]),
      ],
    };
  });

export const resolvePointAreaId = (
  point,
  uuts,
  measurementAreas,
  activeUutId,
) => {
  const resolvedUutId =
    activeUutId || point?.activeUutId || point?.associatedUutIds?.[0];
  const activeUut = (uuts || []).find(
    (uut) => String(uut.id) === String(resolvedUutId),
  );

  const uutAreaId =
    activeUut?.measurementAreaId ||
    (measurementAreas || []).find(
      (area) => area.name === activeUut?.measurementArea,
    )?.id ||
    null;

  return uutAreaId || point?.measurementAreaId || null;
};
