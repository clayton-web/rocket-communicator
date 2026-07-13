plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.aicommunication.assistant.contracts"
    compileSdk = 35

    defaultConfig {
        minSdk = 31
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            kotlin.srcDir(
                file("../../../packages/contracts/generated/kotlin/src/main/kotlin"),
            )
        }
    }
}

dependencies {
    implementation(libs.kotlin.stdlib)
    implementation(libs.moshi.kotlin)
}
