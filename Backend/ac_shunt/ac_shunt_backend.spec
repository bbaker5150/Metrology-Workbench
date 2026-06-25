# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ['entry_point.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('ac_shunt', 'ac_shunt'),
        ('api', 'api'),
        ('uncertainty_data.json', '.'),
    ],
    hiddenimports=[
        'channels', 
        'channels.routing',
        'channels.auth',
        'daphne', 
        'rest_framework', 
        'rest_framework_nested',
        'corsheaders',
        'pyodbc',
        # --- MSSQL Backend Modules (CRITICAL FIX) ---
        'mssql',
        'mssql.base',
        'mssql.compiler',
        'mssql.features',
        'mssql.introspection',
        'mssql.operations',
        'mssql.schema',
        # --- Data processing ---
        'numpy', 
        'pandas', 
        'openpyxl',
        'pyvisa',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['autobahn.xbr'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ac_shunt_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='ac_shunt_backend',
)