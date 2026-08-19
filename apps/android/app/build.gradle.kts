import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ktlint)
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) {
        file.inputStream().use { load(it) }
    }
}

fun configProperty(name: String, default: String): String {
    val raw =
        localProperties.getProperty(name)
            ?: providers.gradleProperty(name).orNull
            ?: System.getenv(name.replace('.', '_').uppercase())
            ?: default
    return raw.replace("\\", "\\\\").replace("\"", "\\\"")
}

android {
    namespace = "com.aicommunication.assistant"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.aicommunication.assistant"
        minSdk = 31
        targetSdk = 35
        versionCode = 5
        versionName = "0.9.4-rc1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Sideload / local defaults. Override via apps/android/local.properties (see README).
        buildConfigField(
            "String",
            "API_BASE_URL",
            "\"${configProperty("aicaa.apiBaseUrl", "http://10.0.2.2:3000")}\""
        )
        buildConfigField(
            "String",
            "SUPABASE_URL",
            "\"${configProperty("aicaa.supabaseUrl", "")}\""
        )
        buildConfigField(
            "String",
            "SUPABASE_ANON_KEY",
            "\"${configProperty("aicaa.supabaseAnonKey", "")}\""
        )
        buildConfigField(
            "String",
            "OWNER_WORKSPACE_DOMAIN",
            "\"${configProperty("aicaa.ownerWorkspaceDomain", "")}\""
        )
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(project(":api-contract"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)

    implementation(platform(libs.supabase.bom))
    implementation(libs.supabase.auth.kt)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.okhttp)
    implementation(libs.moshi.kotlin)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.security.crypto)
    implementation(libs.multiplatform.settings)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation("org.robolectric:robolectric:4.14.1")

    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}

ktlint {
    android.set(true)
    ignoreFailures.set(false)
}
