

#define USE_TEX 1

#include "predefs.vertex.glsl"


varying vec2				io_TexCord0;


void main() {

	gl_Position = gMatrixWorldProj * inPos;

	io_TexCord0 = vec2( inTexCords );

}
