"""Convert a Quaternius animal .blend (Blender 2.79 era, Diffuse BSDF / BI materials) to a raw GLB.

Run with the Blender Python module (pip install bpy==4.2.0 on Python 3.11) or Blender itself:
    python -I docs/brand/models/blend2glb.py -- <in.blend> <out.glb>
    blender -b -P docs/brand/models/blend2glb.py -- <in.blend> <out.glb>

Materials are rebuilt as Principled BSDF using each material's diffuse colour (the glTF exporter
ignores Diffuse BSDF nodes, which would otherwise export as plain white). All actions are exported.
"""
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
bpy.ops.wm.open_mainfile(filepath=src)

for mat in bpy.data.materials:
    col = tuple(mat.diffuse_color)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1.0)
    bsdf.inputs['Roughness'].default_value = 0.8
    bsdf.inputs['Metallic'].default_value = 0.0
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

for ob in bpy.data.objects:
    if ob.type == 'MESH':
        # Clear any custom split normals / keep flat low-poly look as authored.
        pass

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_frame_range=False,
    export_skins=True,
    export_def_bones=False,
    export_apply=False,
    export_yup=True,
)
print('wrote', dst)
