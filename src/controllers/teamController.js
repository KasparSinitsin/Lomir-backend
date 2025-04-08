import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiChevronRight, FiChevronLeft } from 'react-icons/fi';
import TagSelector from '../tags/TagSelector';
import Alert from '../common/Alert';
import { teamService } from '../../services/teamService';

const TeamCreationForm = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isPublic: true,
    maxMembers: 5,
    postalCode: '',
    selectedTags: [],
    tagInterestLevels: {},
    tagExperienceLevels: {}
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const validateStep = () => {
    const newErrors = {};

    switch (step) {
      case 1:
        if (!formData.name) {
          newErrors.name = 'Team name is required';
        } else if (formData.name.length < 3) {
          newErrors.name = 'Team name must be at least 3 characters';
        }

        if (!formData.description) {
          newErrors.description = 'Team description is required';
        } else if (formData.description.length < 10) {
          newErrors.description = 'Description must be at least 10 characters';
        }
        break;

      case 2:
        if (!formData.postalCode) {
          newErrors.postalCode = 'Postal code is required';
        }

        if (formData.maxMembers < 2 || formData.maxMembers > 20) {
          newErrors.maxMembers = 'Team size must be between 2 and 20 members';
        }
        break;

      case 3:
        if (formData.selectedTags.length === 0) {
          newErrors.tags = 'Please select at least one tag for your team';
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let newValue = value;

    if (name === 'maxMembers') {
      newValue = parseInt(value, 10);
      console.log(`maxMembers changed to: ${newValue} (type: ${typeof newValue})`); // Debug log
    } else if (type === 'checkbox') {
      newValue = checked;
    }

    setFormData(prev => ({
      ...prev,
      [name]: newValue
    }));
  };

  const handleTagSelection = (selectedTags, experienceLevels, interestLevels) => {
    setFormData(prev => ({
      ...prev,
      selectedTags,
      tagExperienceLevels: experienceLevels,
      tagInterestLevels: interestLevels
    }));
  };

  const nextStep = () => {
    if (validateStep()) {
      setStep(prev => Math.min(prev + 1, 4));
    }
  };

  const prevStep = () => {
    setStep(prev => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    if (validateStep()) {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const submissionData = {
          name: formData.name,
          description: formData.description,
          is_public: formData.isPublic,
          max_members: formData.maxMembers,
          postal_code: formData.postalCode,
          tags: formData.selectedTags.map(tagId => ({
            tag_id: tagId,
            experience_level: formData.tagExperienceLevels[tagId] || 'beginner',
            interest_level: formData.tagInterestLevels[tagId] || 'medium'
          }))
        };

        console.log('Team data being sent:', submissionData); // Log the final data
        const response = await teamService.createTeam(submissionData);

        // Navigate to the newly created team's page
        navigate(`/teams/${response.data.id}`);
      } catch (error) {
        console.error('Team creation error:', error);
        setSubmitError(
          error.response?.data?.message ||
          error.message ||
          'Failed to create team. Please try again.'
        );
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const renderStepIndicator = () => (
    <div className="flex justify-center space-x-2 mb-6">
      {[1, 2, 3, 4].map(s => (
        <div
          key={s}
          className={`h-2 w-2 rounded-full ${
            step === s ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        />
      ))}
    </div>
  );

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return (
          <>
            <div className="form-control">
              <label className="label">
                <span className="label-text">Team Name</span>
              </label>
              <input
                type="text"
                name="name"
                placeholder="Enter team name"
                className={`input input-bordered ${errors.name ? 'input-error' : ''}`}
                value={formData.name}
                onChange={handleChange}
              />
              {errors.name && (
                <label className="label">
                  <span className="label-text-alt text-error">{errors.name}</span>
                </label>
              )}
            </div>

            <div className="form-control mt-4">
              <label className="label">
                <span className="label-text">Team Description</span>
              </label>
              <textarea
                name="description"
                placeholder="Describe your team's goals and mission"
                className={`textarea textarea-bordered h-24 ${errors.description ? 'textarea-error' : ''}`}
                value={formData.description}
                onChange={handleChange}
              ></textarea>
              {errors.description && (
                <label className="label">
                  <span className="label-text-alt text-error">{errors.description}</span>
                </label>
              )}
            </div>

            <div className="form-control mt-4">
              <label className="label cursor-pointer">
                <span className="label-text">Public Team</span>
                <input
                  type="checkbox"
                  name="isPublic"
                  className="toggle toggle-primary"
                  checked={formData.isPublic}
                  onChange={handleChange}
                />
              </label>
              <p className="text-sm text-gray-500 mt-2">
                Public teams are visible to all users. Private teams require invitation.
              </p>
            </div>
          </>
        );

      case 2:
        return (
          <>
            <div className="form-control">
              <label className="label">
                <span className="label-text">Postal Code</span>
              </label>
              <input
                type="text"
                name="postalCode"
                placeholder="Enter team's postal code"
                className={`input input-bordered ${errors.postalCode ? 'input-error' : ''}`}
                value={formData.postalCode}
                onChange={handleChange}
              />
              {errors.postalCode && (
                <label className="label">
                  <span className="label-text-alt text-error">{errors.postalCode}</span>
                </label>
              )}
              <p className="text-sm text-gray-500 mt-2">
                Used for location-based team matching and discovery
              </p>
            </div>

            <div className="form-control mt-4">
              <label className="label">
                <span className="label-text">Maximum Team Size</span>
              </label>
              <select
                name="maxMembers"
                className={`select select-bordered ${errors.maxMembers ? 'select-error' : ''}`}
                value={formData.maxMembers}
                onChange={handleChange}
              >
                {[2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map(size => (
                  <option key={size} value={size}>{size} members</option>
                ))}
              </select>
              {errors.maxMembers && (
                <label className="label">
                  <span className="label-text-alt text-error">{errors.maxMembers}</span>
                </label>
              )}
            </div>
          </>
        );

      case 3:
        return (
          <div>
            <h3 className="text-lg font-semibold mb-4">Select Team Tags</h3>
            <TagSelector
              onTagsSelected={handleTagSelection}
              selectedTags={formData.selectedTags}
            />
            {errors.tags && (
              <p className="text-error text-sm mt-2">{errors.tags}</p>
            )}
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <h3 className="text-xl font-semibold">Review Team Details</h3>

            <div className="bg-base-200 p-4 rounded-lg">
              <h4 className="font-bold mb-2">Team Basics</h4>
              <p><strong>Name:</strong> {formData.name}</p>
              <p><strong>Description:</strong> {formData.description}</p>
              <p><strong>Visibility:</strong> {formData.isPublic ? 'Public' : 'Private'}</p>
            </div>

            <div className="bg-base-200 p-4 rounded-lg">
              <h4 className="font-bold mb-2">Team Location & Size</h4>
              <p><strong>Postal Code:</strong> {formData.postalCode}</p>
              <p><strong>Maximum Members:</strong> {formData.maxMembers}</p>
            </div>

            <div className="bg-base-200 p-4 rounded-lg">
              <h4 className="font-bold mb-2">Team Tags</h4>
              <div className="flex flex-wrap gap-2">
                {formData.selectedTags.map(tagId => (
                  <span
                    key={tagId}
                    className="badge badge-primary badge-outline"
                  >
                    {tagId}
                    <span className="text-xs ml-1">
                      (Exp: {formData.tagExperienceLevels[tagId] || 'N/A'},
                      Interest: {formData.tagInterestLevels[tagId] || 'N/A'})
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const renderNavButtons = () => {
    return (
      <div className="flex justify-between mt-6">
        {step > 1 && step < 4 && (
          <button
            type="button"
            onClick={prevStep}
            className="btn btn-ghost"
          >
            <FiChevronLeft className="mr-2" /> Previous
          </button>
        )}

        {step < 3 && (
          <button
            type="button"
            onClick={nextStep}
            className="btn btn-primary ml-auto"
          >
            Next <FiChevronRight className="ml-2" />
          </button>
        )}

        {step === 3 && (
          <button
            type="button"
            onClick={nextStep}
            className="btn btn-primary ml-auto"
          >
            Review <FiChevronRight className="ml-2" />
          </button>
        )}

        {step === 4 && (
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="btn btn-ghost"
            >
              <FiChevronLeft className="mr-2" /> Edit
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`btn btn-primary ${isSubmitting ? 'loading' : ''}`}
            >
              {isSubmitting ? 'Creating Team...' : 'Create Team'}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card bg-base-100 shadow-xl mx-auto max-w-md w-full">
      <div className="card-body">
        <h2 className="card-title text-2xl font-bold text-center">Create Team</h2>

        {submitError && (
          <Alert
            type="error"
            message={submitError}
            onClose={() => setSubmitError(null)}
          />
        )}

        <form className="mt-4">
          {renderStepIndicator()}
          {renderStepContent()}
          {renderNavButtons()}
        </form>
      </div>
    </div>
  );
};

export default TeamCreationForm;