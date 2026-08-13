package com.aicommunication.assistant

import android.app.Application
import com.aicommunication.assistant.auth.AuthConfig
import com.aicommunication.assistant.auth.OwnerAuthRepository
import com.aicommunication.assistant.auth.OwnerSessionClient
import com.aicommunication.assistant.auth.SupabaseFactory
import com.aicommunication.assistant.capture.CaptureTaskUseCase
import com.aicommunication.assistant.capture.ManualCaptureRepository
import com.aicommunication.assistant.capture.ManualCaptureUseCase
import com.aicommunication.assistant.capture.PendingCaptureStore
import com.aicommunication.assistant.capture.ProposalOwnerRepository
import com.aicommunication.assistant.capture.TaskOwnerRepository
import com.aicommunication.assistant.network.AndroidConnectivityMonitor
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import com.aicommunication.assistant.network.SessionOwnerRepository
import com.aicommunication.assistant.network.SupabaseAccessTokenProvider
import com.aicommunication.assistant.tasks.GmailOwnerRepository
import com.aicommunication.assistant.tasks.PendingHandoffStore
import com.aicommunication.assistant.tasks.RecipientOwnerRepository
import io.github.jan.supabase.SupabaseClient

class AicaaApplication : Application() {
    lateinit var authConfig: AuthConfig
        private set

    lateinit var apiConfig: ApiConfig
        private set

    var supabaseClient: SupabaseClient? = null
        private set

    lateinit var authRepository: OwnerAuthRepository
        private set

    lateinit var ownerApiExecutor: OwnerApiExecutor
        private set

    lateinit var sessionOwnerRepository: SessionOwnerRepository
        private set

    lateinit var taskOwnerRepository: TaskOwnerRepository
        private set

    lateinit var recipientOwnerRepository: RecipientOwnerRepository
        private set

    lateinit var gmailOwnerRepository: GmailOwnerRepository
        private set

    lateinit var pendingHandoffStore: PendingHandoffStore
        private set

    /**
     * Legacy direct-create capture (A9.2). Kept constructed but unreachable from the Capture UI
     * since S3.3b so the switch onto shared interpretation can be rolled back.
     */
    lateinit var captureTaskUseCase: CaptureTaskUseCase
        private set

    lateinit var pendingCaptureStore: PendingCaptureStore
        private set

    lateinit var proposalOwnerRepository: ProposalOwnerRepository
        private set

    lateinit var manualCaptureUseCase: ManualCaptureUseCase
        private set

    override fun onCreate() {
        super.onCreate()
        authConfig = AuthConfig.fromBuildConfig()
        apiConfig = ApiConfig.fromAuthConfig(authConfig)
        supabaseClient = SupabaseFactory.create(this, authConfig)

        val tokenProvider = SupabaseAccessTokenProvider(supabaseClient)
        val connectivity = AndroidConnectivityMonitor(this)
        val httpClient = OwnerHttpClientFactory.create()
        ownerApiExecutor =
            OwnerApiExecutor(
                apiConfig = apiConfig,
                httpClient = httpClient,
                tokenProvider = tokenProvider,
                connectivity = connectivity
            )
        sessionOwnerRepository = SessionOwnerRepository(ownerApiExecutor)
        taskOwnerRepository = TaskOwnerRepository(ownerApiExecutor)
        recipientOwnerRepository = RecipientOwnerRepository(ownerApiExecutor)
        gmailOwnerRepository = GmailOwnerRepository(ownerApiExecutor)
        pendingHandoffStore = PendingHandoffStore(this)
        captureTaskUseCase = CaptureTaskUseCase(taskOwnerRepository)
        pendingCaptureStore = PendingCaptureStore(this)
        proposalOwnerRepository = ProposalOwnerRepository(ownerApiExecutor)
        manualCaptureUseCase =
            ManualCaptureUseCase(
                repository = ManualCaptureRepository(ownerApiExecutor),
                pendingStore = pendingCaptureStore
            )

        val sessionClient =
            if (authConfig.isConfigured) {
                OwnerSessionClient(sessionOwnerRepository)
            } else {
                null
            }
        authRepository =
            OwnerAuthRepository(
                config = authConfig,
                supabase = supabaseClient,
                sessionClient = sessionClient
            )
    }
}
