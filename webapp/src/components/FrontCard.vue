<script setup>
import { reactive, watch, ref, computed } from 'vue'
import EditableField from './EditableField.vue'
import EditableArrayField from './EditableArrayField.vue'
import WikidataCandidates from './WikidataCandidates.vue'
import WikidataSearch from './WikidataSearch.vue'
import WebResearch from './WebResearch.vue'

const props = defineProps({
  front: { type: Object, default: null },
  imageUrl: { type: String, default: '' },
  minting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:front', 'mint-person', 'mint-person-from-wikidata', 'set-person-qid', 'set-org-qid', 'mint-org', 'mint-org-from-wikidata'])

// Section collapse state
const sections = reactive({
  personal: true,
  contact: true,
  affiliation: true,
  professional: true,
  interests: true,
  wikidataPersonCandidates: true,
  wikidataOrgCandidates: true,
  aiResearch: true
})

function toggleSection(key) {
  sections[key] = !sections[key]
}

// Org type for minting
const orgType = ref('Q1804')

// Deep clone for local editing
function cloneFront() {
  if (!props.front) return null
  return JSON.parse(JSON.stringify(props.front))
}

const localFront = ref(cloneFront())

watch(() => props.front, () => {
  localFront.value = cloneFront()
}, { deep: true })

function updateField(path, value) {
  if (!localFront.value) return
  // path like 'personalIdentification.fullName'
  const parts = path.split('.')
  let obj = localFront.value
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {}
    obj = obj[parts[i]]
  }
  obj[parts[parts.length - 1]] = value
  emit('update:front', JSON.parse(JSON.stringify(localFront.value)))
}

function getField(path) {
  if (!localFront.value) return ''
  const parts = path.split('.')
  let obj = localFront.value
  for (const part of parts) {
    if (obj == null) return ''
    obj = obj[part]
  }
  return obj ?? ''
}

function getArrayField(path) {
  const val = getField(path)
  return Array.isArray(val) ? val : []
}

function hasSection(sectionKey) {
  if (!localFront.value) return false
  return localFront.value[sectionKey] != null
}

function addSection(sectionKey) {
  if (!localFront.value) return
  const defaults = {
    personalIdentification: { fullName: '' },
    contactInformation: { residentialAddress: '', phoneNumbers: '', geographicLocation: '' },
    professionalAffiliation: { employerOrganization: '', departmentDivision: '' },
    professionalIdentityExpertise: { jobTitleOccupation: '', technicalFields: [], specializedSkillsKnowledge: '' },
    interestsCreativeActivities: { artisticPursuits: '', aestheticPhilosophicalInterests: '' }
  }
  localFront.value[sectionKey] = defaults[sectionKey] || {}
  emit('update:front', JSON.parse(JSON.stringify(localFront.value)))
}

const hasPersonMatch = computed(() => {
  const wd = localFront.value?.wikidata_candidates || []
  const wb = localFront.value?.wikibase_candidates || []
  return [...wd, ...wb].some(c => c.match === true)
})

const hasOrgMatch = computed(() => {
  const wd = localFront.value?.wikidata_org_candidates || []
  const wb = localFront.value?.wikibase_org_candidates || []
  return [...wd, ...wb].some(c => c.match === true)
})

function handlePersonImport(qid, source) {
  if (source === 'Wikibase') {
    emit('set-person-qid', qid)
  } else {
    emit('mint-person-from-wikidata', qid)
  }
}

function handlePersonMint() {
  emit('mint-person')
}

function handleManualPersonQid() {
  const qid = window.prompt('Enter the Wikibase QID (e.g. Q12345), or "remove" to clear:')
  if (!qid || !qid.trim()) return
  const trimmed = qid.trim()
  if (trimmed.toLowerCase() === 'remove') {
    emit('set-person-qid', null)
    return
  }
  if (!/^Q\d+$/i.test(trimmed)) {
    window.alert('Invalid QID format. Expected something like Q12345 or "remove".')
    return
  }
  emit('set-person-qid', trimmed.toUpperCase())
}

function handleManualOrgQid() {
  const qid = window.prompt('Enter the Wikibase QID (e.g. Q12345), or "remove" to clear:')
  if (!qid || !qid.trim()) return
  const trimmed = qid.trim()
  if (trimmed.toLowerCase() === 'remove') {
    emit('set-org-qid', null)
    return
  }
  if (!/^Q\d+$/i.test(trimmed)) {
    window.alert('Invalid QID format. Expected something like Q12345 or "remove".')
    return
  }
  emit('set-org-qid', trimmed.toUpperCase())
}

function handleOrgImport(qid, source) {
  if (source === 'Wikibase') {
    emit('set-org-qid', qid)
  } else {
    emit('mint-org-from-wikidata', qid, orgType.value)
  }
}

function handleOrgMint(orgTypeQid) {
  emit('mint-org', orgTypeQid)
}

function handleChunksSelected(chunks) {
  console.log('Selected grounding chunks:', chunks)
}
</script>

<template>
  <div class="space-y-4">
    <!-- Front card image -->
    <div v-if="imageUrl" class="bg-white rounded-lg border border-gray-200 p-3">
      <img
        :src="imageUrl"
        alt="Front of card"
        class="max-w-full h-auto rounded"
        loading="lazy"
      />
    </div>

    <!-- Error state -->
    <div
      v-if="front && front.error"
      class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm"
    >
      <p class="font-medium">Error processing front card data</p>
      <p class="mt-1">{{ front.error }}</p>
    </div>

    <!-- No data state -->
    <div
      v-else-if="!front"
      class="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-gray-500"
    >
      No front card data available.
    </div>

    <!-- Editable metadata -->
    <template v-else>
      <!-- Personal Identification -->
      <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                 transition-colors text-left"
          @click="toggleSection('personal')"
        >
          <h3 class="text-sm font-semibold text-gray-700">Personal Identification</h3>
          <svg
            class="w-4 h-4 text-gray-400 transition-transform"
            :class="{ 'rotate-180': sections.personal }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="sections.personal" class="p-4 space-y-3">
          <template v-if="hasSection('personalIdentification')">
            <EditableField
              label="Full Name"
              :model-value="getField('personalIdentification.fullName')"
              placeholder="Enter full name"
              @update:model-value="updateField('personalIdentification.fullName', $event)"
            />
            <!-- Wikibase person QID link (already minted) -->
            <div v-if="localFront?.wikibase_person_qid" class="mt-1 flex items-center justify-between">
              <a :href="'https://base.semlab.io/wiki/Item:' + localFront.wikibase_person_qid"
                 target="_blank" rel="noopener noreferrer"
                 class="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium">
                <span class="text-xs font-mono bg-blue-50 px-1.5 py-0.5 rounded">{{ localFront.wikibase_person_qid }}</span>
                in Wikibase
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              <button @click="handleManualPersonQid"
                      class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Manually set Semlab Wikibase QID
              </button>
            </div>
            <!-- Mint person button when no match and not yet minted -->
            <div v-else-if="!hasPersonMatch" class="mt-1 flex items-center justify-between">
              <button @click="handlePersonMint"
                      :disabled="minting"
                      class="px-3 py-1.5 text-sm font-medium bg-green-600 text-white
                             rounded-md hover:bg-green-700 transition-colors
                             disabled:opacity-50 disabled:cursor-not-allowed
                             inline-flex items-center gap-1.5">
                <svg v-if="minting" class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {{ minting ? 'Minting...' : 'Mint in Wikibase from card data' }}
              </button>
              <button @click="handleManualPersonQid"
                      class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Manually set Semlab Wikibase QID
              </button>
            </div>
          </template>
          <button
            v-else
            class="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            @click="addSection('personalIdentification')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add personal identification
          </button>
        </div>
      </div>

      <!-- Person Identity Candidates (hidden when already minted) -->
      <div v-if="!localFront?.wikibase_person_qid"
           class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                 transition-colors text-left"
          @click="toggleSection('wikidataPersonCandidates')"
        >
          <h3 class="text-sm font-semibold text-gray-700">Person Identity Candidates</h3>
          <svg
            class="w-4 h-4 text-gray-400 transition-transform"
            :class="{ 'rotate-180': sections.wikidataPersonCandidates }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="sections.wikidataPersonCandidates" class="p-4 space-y-4">
          <div v-if="localFront?.wikidata_candidates?.length">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Wikidata</p>
            <WikidataCandidates
              :candidates="localFront.wikidata_candidates"
              type="person"
              entity-base-url="https://www.wikidata.org/entity/"
              source-label="Wikidata"
              :minting="minting"
              @import="handlePersonImport"
            />
          </div>
          <div v-if="localFront?.wikibase_candidates?.length">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Wikibase</p>
            <WikidataCandidates
              :candidates="localFront.wikibase_candidates"
              type="person"
              entity-base-url="https://base.semlab.io/entity/"
              source-label="Wikibase"
              :minting="minting"
              @import="handlePersonImport"
            />
          </div>
          <div>
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Search Wikidata</p>
            <WikidataSearch
              :minting="minting"
              @import="handlePersonImport"
            />
          </div>
          <div class="pt-2 border-t border-gray-100">
            <button @click="handleManualPersonQid"
                    class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Already in Wikibase — set QID
            </button>
          </div>
        </div>
      </div>

      <!-- AI Slop Research -->
      <div v-if="localFront?.web_research"
           class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                 transition-colors text-left"
          @click="toggleSection('aiResearch')"
        >
          <h3 class="text-sm font-semibold text-gray-700">AI Slop Research</h3>
          <svg
            class="w-4 h-4 text-gray-400 transition-transform"
            :class="{ 'rotate-180': sections.aiResearch }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="sections.aiResearch" class="p-4">
          <WebResearch
            :web-research="localFront.web_research"
            @update:selected-chunks="handleChunksSelected"
          />
        </div>
      </div>

      <!-- Contact Information -->
      <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                 transition-colors text-left"
          @click="toggleSection('contact')"
        >
          <h3 class="text-sm font-semibold text-gray-700">Contact Information</h3>
          <svg
            class="w-4 h-4 text-gray-400 transition-transform"
            :class="{ 'rotate-180': sections.contact }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="sections.contact" class="p-4 space-y-3">
          <template v-if="hasSection('contactInformation')">
            <EditableField
              label="Residential Address"
              type="textarea"
              :model-value="getField('contactInformation.residentialAddress')"
              placeholder="Enter residential address"
              @update:model-value="updateField('contactInformation.residentialAddress', $event)"
            />
            <EditableField
              label="Phone Numbers"
              :model-value="getField('contactInformation.phoneNumbers')"
              placeholder="Enter phone numbers"
              @update:model-value="updateField('contactInformation.phoneNumbers', $event)"
            />
            <EditableField
              label="Geographic Location"
              :model-value="getField('contactInformation.geographicLocation')"
              placeholder="Enter geographic location"
              @update:model-value="updateField('contactInformation.geographicLocation', $event)"
            />
          </template>
          <button
            v-else
            class="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            @click="addSection('contactInformation')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add contact information
          </button>
        </div>
      </div>

      <!-- Professional Affiliation -->
      <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                 transition-colors text-left"
          @click="toggleSection('affiliation')"
        >
          <h3 class="text-sm font-semibold text-gray-700">Professional Affiliation</h3>
          <svg
            class="w-4 h-4 text-gray-400 transition-transform"
            :class="{ 'rotate-180': sections.affiliation }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="sections.affiliation" class="p-4 space-y-3">
          <template v-if="hasSection('professionalAffiliation')">
            <EditableField
              label="Employer / Organization"
              :model-value="getField('professionalAffiliation.employerOrganization')"
              placeholder="Enter employer or organization"
              @update:model-value="updateField('professionalAffiliation.employerOrganization', $event)"
            />
            <EditableField
              label="Department / Division"
              :model-value="getField('professionalAffiliation.departmentDivision')"
              placeholder="Enter department or division"
              @update:model-value="updateField('professionalAffiliation.departmentDivision', $event)"
            />
            <!-- Wikibase org QID link (already minted) -->
            <div v-if="localFront?.wikibase_org_qid" class="mt-1 flex items-center justify-between">
              <a :href="'https://base.semlab.io/wiki/Item:' + localFront.wikibase_org_qid"
                 target="_blank" rel="noopener noreferrer"
                 class="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium">
                <span class="text-xs font-mono bg-blue-50 px-1.5 py-0.5 rounded">{{ localFront.wikibase_org_qid }}</span>
                in Wikibase
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              <button @click="handleManualOrgQid"
                      class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Manually set Semlab Wikibase QID
              </button>
            </div>
            <!-- Mint org when no match, org name filled, and person already minted -->
            <template v-else-if="!hasOrgMatch && getField('professionalAffiliation.employerOrganization') && getField('professionalAffiliation.employerOrganization') !== 'null'">
              <div v-if="localFront?.wikibase_person_qid" class="mt-1 space-y-2">
                <div class="flex items-center gap-4">
                  <label class="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                    <input type="radio" v-model="orgType" value="Q1804" class="text-blue-600" />
                    Institution <span class="text-xs text-gray-400 font-mono">Q1804</span>
                  </label>
                  <label class="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                    <input type="radio" v-model="orgType" value="Q19085" class="text-blue-600" />
                    Business <span class="text-xs text-gray-400 font-mono">Q19085</span>
                  </label>
                </div>
                <div class="flex items-center justify-between">
                  <button @click="handleOrgMint(orgType)"
                          :disabled="minting"
                          class="px-3 py-1.5 text-sm font-medium bg-green-600 text-white
                                 rounded-md hover:bg-green-700 transition-colors
                                 disabled:opacity-50 disabled:cursor-not-allowed
                                 inline-flex items-center gap-1.5">
                    <svg v-if="minting" class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {{ minting ? 'Minting...' : 'Mint in Wikibase from card data' }}
                  </button>
                  <button @click="handleManualOrgQid"
                          class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                    Manually set Semlab Wikibase QID
                  </button>
                </div>
              </div>
              <div v-else class="mt-1 flex items-center justify-between">
                <p class="text-xs text-gray-400 italic">
                  Mint the person first to enable org minting
                </p>
                <button @click="handleManualOrgQid"
                        class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  Manually set Semlab Wikibase QID
                </button>
              </div>
            </template>
          </template>
          <button
            v-else
            class="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            @click="addSection('professionalAffiliation')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add professional affiliation
          </button>
        </div>
      </div>

      <!-- Organization Candidates -->
      <div v-if="!localFront?.wikibase_org_qid"
           class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                 transition-colors text-left"
          @click="toggleSection('wikidataOrgCandidates')"
        >
          <h3 class="text-sm font-semibold text-gray-700">Organization Candidates</h3>
          <svg
            class="w-4 h-4 text-gray-400 transition-transform"
            :class="{ 'rotate-180': sections.wikidataOrgCandidates }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="sections.wikidataOrgCandidates" class="p-4 space-y-4">
          <!-- Org type selector for import -->
          <div class="flex items-center gap-4">
            <span class="text-xs font-medium text-gray-500">Type:</span>
            <label class="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
              <input type="radio" v-model="orgType" value="Q1804" class="text-blue-600" />
              Institution <span class="text-xs text-gray-400 font-mono">Q1804</span>
            </label>
            <label class="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
              <input type="radio" v-model="orgType" value="Q19085" class="text-blue-600" />
              Business <span class="text-xs text-gray-400 font-mono">Q19085</span>
            </label>
          </div>
          <div v-if="localFront?.wikidata_org_candidates?.length">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Wikidata</p>
            <WikidataCandidates
              :candidates="localFront.wikidata_org_candidates"
              type="org"
              entity-base-url="https://www.wikidata.org/entity/"
              source-label="Wikidata"
              :disable-import="!localFront?.wikibase_person_qid"
              disable-import-message="Mint the person first to enable org import"
              :minting="minting"
              @import="handleOrgImport"
            />
          </div>
          <div v-if="localFront?.wikibase_org_candidates?.length">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Wikibase</p>
            <WikidataCandidates
              :candidates="localFront.wikibase_org_candidates"
              type="org"
              entity-base-url="https://base.semlab.io/entity/"
              source-label="Wikibase"
              :disable-import="!localFront?.wikibase_person_qid"
              disable-import-message="Mint the person first to enable org import"
              :minting="minting"
              @import="handleOrgImport"
            />
          </div>
          <div>
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Search Wikidata</p>
            <WikidataSearch
              :minting="minting"
              @import="handleOrgImport"
            />
          </div>
        </div>
      </div>

      <!-- Professional Identity & Expertise -->
      <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                 transition-colors text-left"
          @click="toggleSection('professional')"
        >
          <h3 class="text-sm font-semibold text-gray-700">Professional Identity & Expertise</h3>
          <svg
            class="w-4 h-4 text-gray-400 transition-transform"
            :class="{ 'rotate-180': sections.professional }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="sections.professional" class="p-4 space-y-3">
          <template v-if="hasSection('professionalIdentityExpertise')">
            <EditableField
              label="Job Title / Occupation"
              :model-value="getField('professionalIdentityExpertise.jobTitleOccupation')"
              placeholder="Enter job title or occupation"
              @update:model-value="updateField('professionalIdentityExpertise.jobTitleOccupation', $event)"
            />
            <EditableArrayField
              label="Technical Fields"
              :model-value="getArrayField('professionalIdentityExpertise.technicalFields')"
              @update:model-value="updateField('professionalIdentityExpertise.technicalFields', $event)"
            />
            <EditableField
              label="Specialized Skills / Knowledge"
              type="textarea"
              :model-value="getField('professionalIdentityExpertise.specializedSkillsKnowledge')"
              placeholder="Enter specialized skills or knowledge"
              @update:model-value="updateField('professionalIdentityExpertise.specializedSkillsKnowledge', $event)"
            />
          </template>
          <button
            v-else
            class="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            @click="addSection('professionalIdentityExpertise')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add professional identity & expertise
          </button>
        </div>
      </div>

      <!-- Interests & Creative Activities -->
      <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                 transition-colors text-left"
          @click="toggleSection('interests')"
        >
          <h3 class="text-sm font-semibold text-gray-700">Interests & Creative Activities</h3>
          <svg
            class="w-4 h-4 text-gray-400 transition-transform"
            :class="{ 'rotate-180': sections.interests }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="sections.interests" class="p-4 space-y-3">
          <template v-if="hasSection('interestsCreativeActivities')">
            <EditableField
              label="Artistic Pursuits"
              type="textarea"
              :model-value="getField('interestsCreativeActivities.artisticPursuits')"
              placeholder="Enter artistic pursuits"
              @update:model-value="updateField('interestsCreativeActivities.artisticPursuits', $event)"
            />
            <EditableField
              label="Aesthetic / Philosophical Interests"
              type="textarea"
              :model-value="getField('interestsCreativeActivities.aestheticPhilosophicalInterests')"
              placeholder="Enter aesthetic or philosophical interests"
              @update:model-value="updateField('interestsCreativeActivities.aestheticPhilosophicalInterests', $event)"
            />
          </template>
          <button
            v-else
            class="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            @click="addSection('interestsCreativeActivities')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add interests & creative activities
          </button>
        </div>
      </div>

    </template>
  </div>
</template>
