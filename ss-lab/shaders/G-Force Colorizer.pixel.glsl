

#include "predefs.pixel.glsl"


uniform sampler2D		gTex0;		// Intensity
uniform sampler2D		gTex1;		// ColorMap

varying vec2            io_TexCord0;

void main() {

	vec4 intensity = texture2D( gTex0, io_TexCord0 );

	gl_FragColor = texture2D( gTex1, intensity.ra );

}
