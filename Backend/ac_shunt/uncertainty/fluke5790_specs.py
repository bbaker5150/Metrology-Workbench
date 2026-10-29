"""5790B Service Manual pp. 1-6--1-8 and 1-12, absolute specifications.

Each tuple contains 90-day, 1-year, 2-year ppm-of-reading columns, in the
frequency-band order below. Floors are microvolts; do not RSS the two terms.
Manufacturer confidence is normal, 99%, k=2.58. Relative specifications
require an external standard and are deliberately not substituted here.
"""
INTERVALS = ('90 Days', '1 Year', '2 Years')
FREQUENCIES = (10, 20, 40, 20000, 50000, 100000, 300000, 500000, 1000000)
AC_PPM = {
    .0022: ([1700,740,420,810,1200,2300,2400,3200], [1700,740,420,810,1200,2300,2400,3500], [1700,740,420,820,1200,2300,2600,5000]),
    .007: ([850,370,210,400,600,1200,1300,2000], [850,370,210,400,600,1200,1300,2300], [850,370,210,410,610,1200,1400,3600]),
    .022: ([290,180,110,210,310,810,860,1400], [290,190,110,210,310,810,890,1700], [290,190,110,210,310,820,1000,2600]),
    .07: ([240,120,64,120,260,510,660,1100], [240,120,65,130,260,510,670,1100], [240,130,69,130,260,530,680,1300]),
    .22: ([210,84,37,69,160,240,360,940], [210,85,38,69,160,250,380,1000], [210,87,43,73,160,280,400,1200]),
    .7: ([210,75,31,50,79,160,300,900], [210,76,33,51,79,180,300,960], [210,78,38,56,84,210,340,1200]),
    2.2: ([200,65,22,45,70,150,250,840], [200,66,24,46,71,160,260,900], [200,69,29,52,76,200,310,1200]),
    7: ([200,66,22,46,80,180,380,1100], [200,67,24,48,81,190,400,1200], [200,70,29,53,88,220,470,1500]),
    22: ([200,66,25,46,80,180,380,1100], [200,67,27,48,81,190,400,1200], [200,70,31,53,85,220,470,1500]),
    70: ([200,67,30,56,91,190,400,1100], [200,68,32,57,94,200,410,1200], [200,72,39,63,110,220,510,1500]),
    220: ([200,67,29,67,96,210,440], [200,68,31,69,98,210,500], [200,72,38,77,110,260,700]),
    700: ([200,96,39,120,400], [200,99,41,130,500], [200,110,47,150,850]),
    1000: ([200,96,37,120,400], [200,99,38,130,500], [200,110,44,150,850]),
}
DC_PPM = {
    .22: (37,38,43), .7: (31,33,38), 2.2: (22,24,29), 7: (22,24,29),
    22: (25,27,31), 70: (30,32,39), 220: (29,31,38), 700: (39,41,47), 1000: (37,38,44),
}
TRANSFER_PPM = {
    .22: (210,82,34,67), .7: (210,73,27,47), 2.2: (200,63,18,43),
    7: (200,63,18,44), 22: (200,63,21,44), 70: (200,63,25,55),
    220: (200,63,23,63), 700: (200,92,36), 1000: (200,92,33),
}
CONDITIONS = ('Absolute specification, normal 99% confidence, k=2.58; within ±5 °C of calibration temperature. '
              'Warm up for 30 minutes or twice the off-time, whichever is less. DC zero calibration every 30 days. '
              'AC measurement specifications apply to sine waves. Published ppm-of-reading and voltage-floor terms add linearly.')


def specification_rows(full_scale):
    """Frequency/mode -> interval qualifier leaves; blank manual cells stay absent."""
    for band in range(len(AC_PPM[full_scale][0])):
        low, high = FREQUENCIES[band:band+2]
        notes = CONDITIONS
        typical = full_scale >= 700 and band == 0
        if full_scale in (70, 220) and high > 100000:
            notes += ' Inputs above 100 kHz with V×Hz >2.2e7 are typical.'
        if full_scale == 1000 and high > 30000:
            notes += ' Inputs above 30 kHz and above 750 V are typical.'
        if typical:
            notes += ' This low-frequency specification is typical (Fluke 5205A source).'
        if full_scale == 2.2:
            notes += ' Add 5 ppm for mains disturbances >0.5 Vrms from 10 MHz to 40 MHz.'
        for interval, values in enumerate(AC_PPM[full_scale]):
            floors = [1.3 if full_scale < .07 else 1.5]*3 + [2,2.5,4,6 if interval == 0 else 8,6 if interval == 0 else 8]
            yield {'key': f'ac-{band}-{interval}', 'mode': 'AC', 'low': low, 'high': high,
                   'interval': interval, 'ppm': values[band], 'floor': floors[band] if full_scale < 2.2 else 0,
                   'notes': notes, 'typical': typical, 'page': '1-6 to 1-8'}
    if full_scale in (.07, .22, .7, 2.2, 7, 22, 70):
        for interval in range(3):
            yield {'key': f'ac-low-{interval}', 'mode': 'AC', 'low': 9.5, 'high': 10,
                   'interval': interval, 'ppm': 1000, 'floor': 1.5 if full_scale < 2.2 else 0,
                   'notes': CONDITIONS + ' 9.5–10 Hz extension, footnotes 1 and 2.', 'page': '1-8'}
    if full_scale in DC_PPM:
        for interval, ppm in enumerate(DC_PPM[full_scale]):
            yield {'key': f'dc-{interval}', 'mode': 'DC', 'interval': interval, 'ppm': ppm,
                   'floor': 1.5 if full_scale < 2.2 else 0, 'page': '1-12',
                   'notes': CONDITIONS + ' DC requires averaging equal and opposite polarities to remove offset. Input 1 is not recommended for DC.'}
    for band, ppm in enumerate(TRANSFER_PPM.get(full_scale, ())):
        low, high = FREQUENCIES[band:band+2]
        yield {'key': f'transfer-{band}-2', 'mode': 'AC/DC Transfer', 'low': low, 'high': high,
               'interval': 2, 'ppm': ppm, 'floor': 0, 'page': '1-6 to 1-8',
               'typical': full_scale >= 700 and band == 0,
               'notes': CONDITIONS + ' AC/DC transfer-mode specification, 2 years; not a measurement-mode accuracy substitution.'}
