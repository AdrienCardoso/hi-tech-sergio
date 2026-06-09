


#include "predefs.vertex.glsl"


#if USE_TEX
varying vec2				io_TexCord0;
#endif


#if USE_LIGHTING

#define gAmbientLightColor  gVertexParams[2]



#define LIGHT_ENABLED( _N )             gVertexParams[ _N * ss_QuadsPerLight + 3     ].w > 0.0


#define light_pos( _N )                 vec3( gVertexParams[ _N * ss_QuadsPerLight + 3     ] )
#define light_dir( _N )                 vec3( gVertexParams[ _N * ss_QuadsPerLight + 3 + 1 ] )

#define light_spot_rho_base( _N )       gVertexParams[ _N * ss_QuadsPerLight + 3 + 2 ].x
#define light_spot_rho_scale( _N )      gVertexParams[ _N * ss_QuadsPerLight + 3 + 2 ].y
#define light_spot_falloff( _N )        gVertexParams[ _N * ss_QuadsPerLight + 3 + 2 ].z
#define light_spotEnabled( _N )         gVertexParams[ _N * ss_QuadsPerLight + 3 + 2 ].w

#define light_color( _N )               gVertexParams[ _N * ss_QuadsPerLight + 3 + 3 ]

#define light_attenEnabled( _N )        gVertexParams[ _N * ss_QuadsPerLight + 3 + 4 ].x
#define light_attenFactor( _N )         gVertexParams[ _N * ss_QuadsPerLight + 3 + 4 ].y
#define light_specularPower( _N )       gVertexParams[ _N * ss_QuadsPerLight + 3 + 4 ].z





#define APPLY_LIGHT( _N )                                                                                                   \
    posOffset = light_pos(_N) - light_attenEnabled(_N) * viewPos;                                                           \
    lightDir  = normalize( posOffset );                                                                                     \
                                                                                                                            \
    float NdotL = dot( viewNormal, lightDir );                                                                              \
    if ( NdotL > 0.0 ) {                                                                                                    \
                                                                                                                            \
        float dist = length( posOffset );                                                                                   \
                                                                                                                            \
        /* spot cone computation - dot the light ray path vs. light dir */                                                  \
        float rho = dot( lightDir, light_dir(_N) );                                                                         \
                                                                                                                            \
        float atten = mix(  1.0,                                                                                            \
                            1.0 / ( 1.0 + light_attenFactor(_N) * dist ),                                                   \
                            light_attenEnabled(_N) );                                                                       \
        atten      *= mix(  1.0,                                                                                            \
                            pow( clamp( ( rho - light_spot_rho_base(_N) ) * light_spot_rho_scale(_N), 0.0, 1.0 ),           \
                                 light_spot_falloff(_N) ),                                                                  \
                            light_spotEnabled(_N) );                                                                        \
                                                                                                                            \
        color_diff += ( atten * NdotL ) * light_color(_N);                                                                  \
                                                                                                                            \
        float specularPower = light_specularPower(_N);                                                                      \
        if ( specularPower > 0.0 ) {                                                                                        \
            color_spec += ( atten * pow( max( 0.0, dot( reflect( - lightDir, viewNormal ), viewDir ) ),                     \
                                    specularPower ) ) * light_color(_N);                                                    \
        }                                                                                                                   \
    }                                                                                                                       \


#endif







void main() {

    gl_Position = gMatrixWorldProj * inPos;

    #if USE_LIGHTING || USE_FOG
        vec3 viewPos = vec3( gMatrixWorld * inPos );
    #endif


    #if USE_TEX
        #if USE_TEX_MATRIX
            io_TexCord0 = vec2( gMatrixTex * inTexCords );
        #else
            io_TexCord0 = vec2(              inTexCords );
        #endif
    #endif


    #if USE_LIGHTING

        vec3 viewNormal = normalize( gMatrixNormal * inNormal );    // normal in view space
        vec3 viewDir = - normalize( viewPos );
        
        vec4 color_diff = gAmbientLightColor;
        vec4 color_spec = vec4( 0, 0, 0, 0 );

        vec3 posOffset;
        vec3 lightDir;

        // Note that we don't test if the first light is enabled since USE_LIGHTING wouldn't be set otherwise.
        APPLY_LIGHT( 0 )

        if ( LIGHT_ENABLED( 1 ) ) {
            APPLY_LIGHT( 1 )

            if ( LIGHT_ENABLED( 2 ) ) {
                APPLY_LIGHT( 2 )

                if ( LIGHT_ENABLED( 3 ) ) {
                    APPLY_LIGHT( 3 )
                }
            }
        }

        #if USE_VERTEX_COLOR
            io_Color = gVertexModColor * ( inColor * clamp( color_diff, 0.0, 1.0 ) + clamp( color_spec, 0.0, 1.0 ) );
        #else
            io_Color = gVertexModColor * (           clamp( color_diff, 0.0, 1.0 ) + clamp( color_spec, 0.0, 1.0 ) );
        #endif

    #else

        #if USE_VERTEX_COLOR
            io_Color = gVertexModColor * inColor;
        #else
            io_Color = gVertexModColor;
        #endif

    #endif




    #if USE_FOG
        io_FogWeight = clamp( ( gFogOffset + viewPos.z ) * gFogScale, 0.0, 1.0 );
    #endif

}
