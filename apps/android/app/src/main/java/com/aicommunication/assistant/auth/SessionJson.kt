package com.aicommunication.assistant.auth

import com.squareup.moshi.Moshi

/** Compatibility export — Moshi configuration lives in the networking package (A9.1). */
fun ownerApiMoshi(): Moshi = com.aicommunication.assistant.network.ownerApiMoshi()
