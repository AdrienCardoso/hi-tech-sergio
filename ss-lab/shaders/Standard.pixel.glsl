

#include "predefs.pixel.glsl"

#if USE_TEX
    uniform sampler2D	gTex0;

    #define FRAG_COLOR	io_Color * texture2D( gTex0, io_TexCord0 )
#else
    #define FRAG_COLOR	io_Color
#endif



void main() {

	#if USE_FOG
		gl_FragColor = mix( gFogColor, FRAG_COLOR, io_FogWeight );
	#else
		gl_FragColor = FRAG_COLOR;
	#endif


}


