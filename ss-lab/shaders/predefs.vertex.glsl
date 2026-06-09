

uniform mat4                gMatrixWorldProj;
uniform mat4                gMatrixWorld;


attribute vec4              inPos;

#if USE_VERTEX_COLOR
attribute vec4              inColor;
#endif

#if USE_LIGHTING
attribute vec3              inNormal;
uniform mat3                gMatrixNormal;
#endif

#if USE_TEX
attribute vec4              inTexCords;
attribute vec4              inAux1Cords;
attribute vec4              inAux2Cords;
#endif

#if USE_TEX_MATRIX
uniform mat4                gMatrixTex;
uniform mat4                gMatrixAux1;
uniform mat4                gMatrixAux2;
uniform mat4                gMatrixAux3;
#endif



uniform vec4                gVertexParams[ 32 ];

#define gVertexModColor     gVertexParams[ 0 ]


// Carries the interpolated color to each fragment
varying vec4                io_Color;




#if USE_FOG
varying float               io_FogWeight;


#define gFogOffset          gVertexParams[1].x
#define gFogScale           gVertexParams[1].y
#endif




#define ss_QuadsPerLight    5
