plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "dev.salamifocus"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.salamifocus"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Release builds are signed only when a keystore is supplied, from outside
    // the repository (see docs/deploy.md).
    val keystore = providers.environmentVariable("SALAMIFOCUS_KEYSTORE").orNull
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = providers.environmentVariable("SALAMIFOCUS_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("SALAMIFOCUS_KEY_ALIAS").getOrElse("salamifocus")
                keyPassword = storePassword
            }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // Each build type has its own property, so a release address kept in
    // ~/.gradle/gradle.properties does not leak into development builds.
    fun serverUrl(property: String, default: String) = "\"${project.findProperty(property) ?: default}\""
    buildTypes {
        debug {
            // By default, the emulator's address for the development machine.
            buildConfigField("String", "DEFAULT_SERVER_URL", serverUrl("salamifocus.serverUrl", "http://10.0.2.2:3100"))
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "DEFAULT_SERVER_URL", serverUrl("salamifocus.releaseServerUrl", ""))
            signingConfig = signingConfigs.findByName("release")
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.powersync.core)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.work.runtime)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
