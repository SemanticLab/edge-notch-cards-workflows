<script setup>
import { reactive, watch, ref, computed } from 'vue'
import EditableField from './EditableField.vue'
import EditableArrayField from './EditableArrayField.vue'
import WikidataCandidates from './WikidataCandidates.vue'
import WebResearch from './WebResearch.vue'

const props = defineProps({
  front: { type: Object, default: null },
  imageUrl: { type: String, default: '' }
})

const emit = defineEmits(['update:front'])

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

function handlePersonImport(qid) {
  console.log('Import person from Wikidata:', qid)
}

function handlePersonMint() {
  console.log('Mint person in Wikibase:', localFront.value?.personalIdentification?.fullName)
}

function handleOrgImport(qid) {
  console.log('Import org from Wikidata:', qid)
}

function handleOrgMint(orgType) {
  console.log('Mint org in Wikibase:', orgType)
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
            <!-- Mint person button when no match exists -->
            <div v-if="!hasPersonMatch" class="mt-1">
              <button @click="handlePersonMint"
                      class="px-3 py-1.5 text-sm font-medium bg-green-600 text-white
                             rounded-md hover:bg-green-700 transition-colors">
                Mint in Wikibase from card data
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

      <!-- Person Identity Candidates -->
      <div v-if="localFront?.wikidata_candidates?.length || localFront?.wikibase_candidates?.length"
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
              @import="handlePersonImport"
            />
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
            <!-- Mint org button when no match exists -->
            <div v-if="!hasOrgMatch" class="mt-1">
              <button @click="handleOrgMint('institution')"
                      class="px-3 py-1.5 text-sm font-medium bg-green-600 text-white
                             rounded-md hover:bg-green-700 transition-colors">
                Mint in Wikibase from card data
              </button>
            </div>
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
      <div v-if="localFront?.wikidata_org_candidates?.length || localFront?.wikibase_org_candidates?.length"
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
          <div v-if="localFront?.wikidata_org_candidates?.length">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Wikidata</p>
            <WikidataCandidates
              :candidates="localFront.wikidata_org_candidates"
              type="org"
              entity-base-url="https://www.wikidata.org/entity/"
              source-label="Wikidata"
              @import="handleOrgImport"
              @mint="handleOrgMint"
            />
          </div>
          <div v-if="localFront?.wikibase_org_candidates?.length">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Wikibase</p>
            <WikidataCandidates
              :candidates="localFront.wikibase_org_candidates"
              type="org"
              entity-base-url="https://base.semlab.io/entity/"
              source-label="Wikibase"
              @import="handleOrgImport"
              @mint="handleOrgMint"
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
