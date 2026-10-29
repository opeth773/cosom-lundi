import java.util.Properties

plugins { id("com.android.application") }

val googleClient = rootProject.file("google-web-client-id.txt").readText().trim()
val signingFile = providers.environmentVariable("COSOM_ANDROID_SIGNING_PROPERTIES").orNull?.let { file(it) }
val releaseSigning = Properties().apply {
    if (signingFile?.isFile == true) signingFile.inputStream().use { load(it) }
}
android {
    namespace = "ca.cosomlundi.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "ca.cosomlundi.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0-preview.1"
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleClient\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets["main"].assets.srcDir("../web")
    if (signingFile?.isFile == true) {
        signingConfigs.create("cosomRelease") {
            storeFile = file(releaseSigning.getProperty("storeFile"))
            storePassword = releaseSigning.getProperty("storePassword")
            keyAlias = releaseSigning.getProperty("keyAlias")
            keyPassword = releaseSigning.getProperty("keyPassword")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (signingFile?.isFile == true) signingConfig = signingConfigs.getByName("cosomRelease")
        }
    }
}
val verifyReleaseSigning by tasks.registering {
    doLast {
        check(signingFile?.isFile == true) {
            "Set COSOM_ANDROID_SIGNING_PROPERTIES to a private signing.properties file outside the checkout."
        }
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(verifyReleaseSigning) }
dependencies {
    implementation("androidx.activity:activity:1.11.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
}
