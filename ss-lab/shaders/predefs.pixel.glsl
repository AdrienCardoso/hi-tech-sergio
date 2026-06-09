

uniform vec4		gParams[ 2 ];

varying vec4		io_Color;


#if USE_TEX
varying vec2		io_TexCord0;
#endif

#if USE_FOG
varying float		io_FogWeight;

#define gFogColor	gParams[0]
#endif



