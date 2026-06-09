#!/usr/bin/env python3
"""Сканирует распакованные .pkg и строит manifests для soundspectrum-lab.html"""
import json, os, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def walk_txt(base, label):
    items = []
    if not base.exists():
        return items
    for p in sorted(base.rglob('*.txt')):
        rel = p.relative_to(ROOT).as_posix()
        name = p.stem
        if p.parent.name not in ('WaveShapes', 'Particles', 'FlowFields', 'ColorMaps', 'Backgrounds', label):
            name = f"{p.parent.name}/{name}"
        items.append({"name": name, "path": rel, "type": label})
    return items

def main():
    gforce_base = ROOT / '.gforce_extract/com.soundspectrum.G-Force.support.pkg/payload_out/Application Support/SoundSpectrum/G-Force/Packages'
    whitecap_base = ROOT / '.whitecap_extract/com.soundspectrum.WhiteCap.support.pkg/payload_out/Application Support/SoundSpectrum/WhiteCap/Packages'
    aeon_base = ROOT / '.aeon_extract/com.soundspectrum.Aeon.support.pkg/payload_out/Application Support/SoundSpectrum/Aeon/Packages/Aeon.Scene.package'

    gforce = {
        "product": "G-Force 5.9.5",
        "flowfields": walk_txt(gforce_base / 'G-Force.FlowField.package', 'flowfield'),
        "waveshapes": walk_txt(gforce_base / 'G-Force.WaveShape.package/WaveShapes', 'waveshape'),
        "particles": walk_txt(gforce_base / 'G-Force.WaveShape.package/Particles', 'particle'),
        "colormaps": walk_txt(gforce_base / 'G-Force.ColorMap.package', 'colormap'),
    }
    def walk_txt_clean(base, label):
        items = walk_txt(base, label)
        for it in items:
            p = it['name']
            if '/' in p:
                it['name'] = p.split('/')[-1]
            it['name'] = it['name'].replace('WhiteCap.WaveShape.package/', '').replace('WhiteCap.ColorScheme.package/', '')
        return items

    whitecap = {
        "product": "WhiteCap 6.9.6",
        "waveshapes": walk_txt_clean(whitecap_base / 'WhiteCap.WaveShape.package', 'waveshape'),
        "colorschemes": walk_txt_clean(whitecap_base / 'WhiteCap.ColorScheme.package', 'colormap'),
    }
    aeon_scenes = []
    if aeon_base.exists():
        for p in sorted(aeon_base.rglob('*.py')):
            if p.name.startswith('_'): continue
            rel = p.relative_to(ROOT).as_posix()
            aeon_scenes.append({"name": p.stem, "path": rel, "type": "aeon-scene"})
    aeon = {"product": "Aeon 4.2.6", "scenes": aeon_scenes}

    out = ROOT / 'ss-lab/manifests'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'gforce.json').write_text(json.dumps(gforce, ensure_ascii=False, indent=2), encoding='utf-8')
    (out / 'whitecap.json').write_text(json.dumps(whitecap, ensure_ascii=False, indent=2), encoding='utf-8')
    (out / 'aeon.json').write_text(json.dumps(aeon, ensure_ascii=False, indent=2), encoding='utf-8')
    print('G-Force:', len(gforce['flowfields']), 'flow,', len(gforce['waveshapes']), 'wave')
    print('WhiteCap:', len(whitecap['waveshapes']), 'wave')
    print('Aeon:', len(aeon_scenes), 'scenes')

if __name__ == '__main__':
    main()
