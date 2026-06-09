

#include "predefs.pixel.glsl"

uniform sampler2D       gTex0;
uniform sampler2D		gTex1;		// ColorMap


void main() {

	vec4 intensity;

	#if USE_TEX
		intensity = io_Color * texture2D( gTex0, io_TexCord0 );
	#else
		intensity = io_Color;
	#endif

	vec2 colorCords = vec2( intensity.r * gParams[1].x + gParams[1].y, 0 );

	gl_FragColor = texture2D( gTex1, colorCords );	
	gl_FragColor.a = intensity.a;

	#if USE_FOG
		gl_FragColor = mix( gFogColor, gl_FragColor, io_FogWeight );
	#endif
}

