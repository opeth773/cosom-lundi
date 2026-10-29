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
        versionCode = 4
        versionName = "1.0.0-preview.4"
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleClient\"")
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets["main"].assets.srcDir("../web")
    sourceSets["main"].assets.srcDir("../model-assets")
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
val verifyVoiceModel by tasks.registering {
    doLast {
        check(rootProject.file("model-assets/voice-model-fr/am/final.mdl").isFile) {
            "Run python3 tools/prepare_voice_model.py before building Android."
        }
    }
}
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(verifyVoiceModel) }
val verifyReleaseSigning by tasks.registering {
    doLast {
        check(signingFile?.isFile == true) {
            "Set COSOM_ANDROID_SIGNING_PROPERTIES to a private signing.properties file outside the checkout."
        }
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(verifyReleaseSigning) }
tasks.withType<Test>().configureEach {
    systemProperty("robolectric.dependency.repo.url", "https://repo.maven.apache.org/maven2")
    listOf("https.proxyHost", "https.proxyPort", "http.proxyHost", "http.proxyPort", "http.nonProxyHosts").forEach { name ->
        System.getProperty(name)?.let { systemProperty(name, it) }
    }
}
dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    implementation("com.alphacephei:vosk-android:0.3.75")
    implementation("androidx.activity:activity:1.11.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
}
